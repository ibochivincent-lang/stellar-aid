import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { EventEngineService } from '../events/event-engine.service';
import { AidVoucherEvent } from '../events/event.types';
import { AnomalyHit, scoreMerchantVelocity, scoreRapidRedemption, scoreRecipientFanout } from './heuristics';
import { OracleClientService } from './oracle-client.service';

/**
 * Off-chain fraud/anomaly scanner. Subscribes to the same
 * `EventEngineService` stream `WebhookDeliveryService` already consumes
 * (issued/redeemed/...), scores each event against a few explainable
 * heuristics (see heuristics.ts), and — when a score crosses its
 * threshold — proposes the finding on-chain via the oracle role
 * (`OracleClientService`) and always records it in `AuditLog`, whether or
 * not the on-chain post succeeds.
 *
 * "Proposes", not decides: this service can only call `flag_merchant` /
 * `post_anomaly`, which the contract treats as informational events (see
 * the "Anomaly oracle" module doc in contracts/src/lib.rs) — nothing here
 * can freeze a voucher, deactivate a merchant, or move funds. An admin
 * reviewing flagged/anomaly events (or this service's audit trail) decides
 * whether to act, e.g. by calling `set_merchant(active: false)` themselves.
 *
 * State is in-memory and per-process (sliding-window timestamp lists,
 * pruned on each check, plus a cooldown map so one burst doesn't refire the
 * same flag on every subsequent event). That means a restart loses
 * in-flight windows and a multi-instance deployment would double-count —
 * both acceptable for a heuristic proposer whose output is advisory, but
 * worth knowing; a persistent store would be the fix if this needs to scale
 * beyond one process (tracked in ROADMAP.md).
 */
@Injectable()
export class AnomalyScannerService implements OnModuleInit {
  private readonly logger = new Logger(AnomalyScannerService.name);

  /** voucherId -> issuance time (ms), so a later `redeemed` for the same id can compute time-to-redemption. */
  private readonly issuedAt = new Map<number, number>();
  /** merchant wallet -> recent redemption timestamps (ms), pruned to the velocity window on each check. */
  private readonly merchantRedemptions = new Map<string, number[]>();
  /** recipient wallet -> recent issuance timestamps (ms), pruned to the fan-out window on each check. */
  private readonly recipientIssuances = new Map<string, number[]>();

  private readonly lastFlaggedVoucher = new Map<number, number>();
  private readonly lastFlaggedMerchant = new Map<string, number>();
  private readonly lastFlaggedRecipient = new Map<string, number>();

  private readonly rapidRedemptionSeconds = Number(process.env.FRAUD_RAPID_REDEMPTION_SECONDS ?? 30);
  private readonly merchantVelocityWindowMs = Number(process.env.FRAUD_MERCHANT_VELOCITY_WINDOW_MS ?? 60_000);
  private readonly merchantVelocityThreshold = Number(process.env.FRAUD_MERCHANT_VELOCITY_THRESHOLD ?? 10);
  private readonly recipientFanoutWindowMs = Number(process.env.FRAUD_RECIPIENT_FANOUT_WINDOW_MS ?? 3_600_000);
  private readonly recipientFanoutThreshold = Number(process.env.FRAUD_RECIPIENT_FANOUT_THRESHOLD ?? 5);
  /** Minimum gap between two flags for the same key, so a sustained burst doesn't spam on-chain posts / audit rows. */
  private readonly cooldownMs = Number(process.env.FRAUD_FLAG_COOLDOWN_MS ?? 600_000);

  constructor(
    private readonly engine: EventEngineService,
    private readonly oracle: OracleClientService,
    private readonly auditLog: AuditLogService,
  ) {}

  onModuleInit(): void {
    if (!this.oracle.isConfigured) {
      this.logger.warn(
        'AID_ORACLE_SIGNING_SECRET / AID_VOUCHER_CONTRACT_ID not set — anomaly scanner will score events and write AuditLog entries, but will not post findings on-chain',
      );
    }
    this.engine.onEvent((event) => void this.handle(event));
  }

  private async handle(event: AidVoucherEvent): Promise<void> {
    try {
      if (event.type === 'issued') {
        await this.onIssued(event.data.voucherId, event.data.recipient, event.ledgerClosedAt);
      } else if (event.type === 'redeemed') {
        await this.onRedeemed(event.data.voucherId, event.data.merchant, event.ledgerClosedAt);
      }
    } catch (e) {
      // A scoring bug must never take down the shared event pipeline —
      // same defensive posture as decodeContractEvent and webhook delivery.
      this.logger.warn(`anomaly scan failed for event ${event.id}: ${e}`);
    }
  }

  private async onIssued(voucherId: number, recipient: string, ledgerClosedAt: string): Promise<void> {
    const now = parseLedgerTime(ledgerClosedAt);
    this.issuedAt.set(voucherId, now);

    const timestamps = prune(this.recipientIssuances.get(recipient) ?? [], now, this.recipientFanoutWindowMs);
    timestamps.push(now);
    this.recipientIssuances.set(recipient, timestamps);

    const hit = scoreRecipientFanout(timestamps.length, this.recipientFanoutThreshold);
    if (hit && this.shouldFlag(this.lastFlaggedRecipient, recipient, now)) {
      // No single voucher "is" a fan-out pattern — post it against the
      // triggering voucher (so it's visible in the per-voucher event
      // stream alongside rapid-redemption findings) and keep the
      // recipient + count in the audit metadata for investigation.
      await this.raiseAnomaly(voucherId, hit, { recipient, count: timestamps.length });
    }
  }

  private async onRedeemed(voucherId: number, merchant: string, ledgerClosedAt: string): Promise<void> {
    const now = parseLedgerTime(ledgerClosedAt);

    const issuedAtMs = this.issuedAt.get(voucherId);
    if (issuedAtMs !== undefined) {
      const rapid = scoreRapidRedemption(issuedAtMs, now, this.rapidRedemptionSeconds);
      if (rapid && this.shouldFlag(this.lastFlaggedVoucher, voucherId, now)) {
        await this.raiseAnomaly(voucherId, rapid, { secondsToRedeem: (now - issuedAtMs) / 1000 });
      }
      this.issuedAt.delete(voucherId);
    }

    const timestamps = prune(this.merchantRedemptions.get(merchant) ?? [], now, this.merchantVelocityWindowMs);
    timestamps.push(now);
    this.merchantRedemptions.set(merchant, timestamps);

    const velocity = scoreMerchantVelocity(timestamps.length, this.merchantVelocityThreshold);
    if (velocity && this.shouldFlag(this.lastFlaggedMerchant, merchant, now)) {
      await this.raiseMerchantFlag(merchant, velocity, { count: timestamps.length });
    }
  }

  private shouldFlag<K>(lastFlagged: Map<K, number>, key: K, now: number): boolean {
    const last = lastFlagged.get(key);
    if (last !== undefined && now - last < this.cooldownMs) return false;
    lastFlagged.set(key, now);
    return true;
  }

  private async raiseAnomaly(
    voucherId: number,
    hit: AnomalyHit,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.logger.warn(`anomaly voucher=${voucherId} score=${hit.score} reason=${hit.reason}`);
    await this.auditLog.record({
      actor: 'system:anomaly-scanner',
      action: 'fraud.anomaly_detected',
      entityType: 'Voucher',
      entityId: String(voucherId),
      metadata: { score: hit.score, reason: hit.reason, ...metadata },
    });
    if (!this.oracle.isConfigured) return;
    try {
      await this.oracle.postAnomaly(voucherId, hit.score, hit.reason);
    } catch (e) {
      this.logger.warn(`failed to post anomaly on-chain for voucher ${voucherId}: ${e}`);
    }
  }

  private async raiseMerchantFlag(
    merchant: string,
    hit: AnomalyHit,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    this.logger.warn(`flagging merchant=${merchant} score=${hit.score} reason=${hit.reason}`);
    await this.auditLog.record({
      actor: 'system:anomaly-scanner',
      action: 'fraud.merchant_flagged',
      entityType: 'Merchant',
      entityId: merchant,
      metadata: { score: hit.score, reason: hit.reason, ...metadata },
    });
    if (!this.oracle.isConfigured) return;
    try {
      await this.oracle.flagMerchant(merchant, hit.reason);
    } catch (e) {
      this.logger.warn(`failed to flag merchant on-chain for ${merchant}: ${e}`);
    }
  }
}

function parseLedgerTime(ledgerClosedAt: string): number {
  const parsed = Date.parse(ledgerClosedAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function prune(timestamps: number[], now: number, windowMs: number): number[] {
  return timestamps.filter((t) => now - t <= windowMs);
}
