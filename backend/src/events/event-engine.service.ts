import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { PrismaService } from '../common/prisma.service';
import { StellarService } from '../stellar/stellar.service';
import { decodeContractEvent } from './event-decoder';
import { AidVoucherEvent } from './event.types';

/**
 * Polls Soroban RPC for `aid_voucher` contract events, decodes them, and
 * fans them out to anything listening (the SSE endpoint, webhook delivery).
 *
 * This is the stellar-aid-scoped equivalent of an "event engine": Soroban
 * RPC has no native subscription/push model (only `getEvents` polling with a
 * retention window of ~7 days), so — same as any Horizon/Soroban consumer —
 * this normalizes that into a push-shaped `EventEmitter` and persists a
 * cursor (`EventCursor`) so a restart resumes from where it left off instead
 * of re-scanning history or dropping events emitted while the process
 * was down within the retention window.
 */
@Injectable()
export class EventEngineService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventEngineService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  private readonly pollIntervalMs = Number(process.env.EVENTS_POLL_INTERVAL_MS ?? 5000);
  private readonly pageLimit = Number(process.env.EVENTS_PAGE_LIMIT ?? 100);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {
    super();
    this.setMaxListeners(0); // many SSE clients may subscribe concurrently
  }

  get contractId(): string | undefined {
    return process.env.AID_VOUCHER_CONTRACT_ID;
  }

  onModuleInit(): void {
    if (!this.contractId) {
      this.logger.warn('AID_VOUCHER_CONTRACT_ID not set — event engine idle');
      return;
    }
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    void this.poll();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async getStartLedger(contractId: string): Promise<number> {
    const cursor = await this.prisma.eventCursor.findUnique({ where: { contractId } });
    if (cursor) return cursor.lastLedger + 1;

    // No cursor yet: start from the current ledger rather than the full
    // retention window, so a first boot doesn't replay every historical
    // voucher event as if it just happened.
    const latest = await this.stellar.rpc.getLatestLedger();
    return latest.sequence;
  }

  private async poll(): Promise<void> {
    const contractId = this.contractId;
    if (!contractId || this.polling) return;
    this.polling = true;
    try {
      const startLedger = await this.getStartLedger(contractId);
      const resp = await this.stellar.rpc.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds: [contractId] }],
        limit: this.pageLimit,
      });

      let lastLedger = startLedger - 1;
      for (const raw of resp.events) {
        const event = decodeContractEvent(raw);
        this.emit('event', event);
        this.emit(event.type, event);
        lastLedger = Math.max(lastLedger, raw.ledger);
      }

      if (resp.events.length > 0) {
        await this.prisma.eventCursor.upsert({
          where: { contractId },
          create: { contractId, lastLedger },
          update: { lastLedger },
        });
      }
    } catch (e) {
      // A transient RPC hiccup (or the retention window rolling past a
      // stale cursor) shouldn't kill the poller — log and retry next tick.
      this.logger.warn(`event poll failed: ${e}`);
    } finally {
      this.polling = false;
    }
  }

  /** Type-safe subscribe, kept separate from EventEmitter's untyped `on`. */
  onEvent(handler: (event: AidVoucherEvent) => void): () => void {
    this.on('event', handler);
    return () => this.off('event', handler);
  }
}
