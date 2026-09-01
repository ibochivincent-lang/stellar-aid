import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EventEngineService } from '../events/event-engine.service';
import { AidVoucherEvent } from '../events/event.types';
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from './verify';

const RETRY_DELAYS_MS = [0, 2_000, 8_000];

/** Just the fields this service reads off a `WebhookSubscription` row. */
interface SubscriptionRow {
  id: string;
  url: string;
  secret: string;
  eventTypes: string[];
}

/**
 * HMAC-signed webhook fan-out — the stellar-aid-scoped equivalent of
 * Orbital's `pulse-webhooks`: every decoded voucher-lifecycle event goes out
 * to each active, matching `WebhookSubscription` with a `sha256=` HMAC
 * signature the receiver can check with `verifyWebhookSignature` (see
 * verify.ts), retried with backoff, with each attempt logged for debugging.
 */
@Injectable()
export class WebhookDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EventEngineService,
  ) {}

  onModuleInit(): void {
    this.engine.onEvent((event) => void this.deliverToSubscribers(event));
  }

  private async deliverToSubscribers(event: AidVoucherEvent): Promise<void> {
    const subs: SubscriptionRow[] = await this.prisma.webhookSubscription.findMany({
      where: { active: true },
    });
    const matching = subs.filter(
      (s: SubscriptionRow) => s.eventTypes.length === 0 || s.eventTypes.includes(event.type),
    );
    await Promise.all(matching.map((sub: SubscriptionRow) => this.deliverWithRetry(sub, event)));
  }

  private async deliverWithRetry(sub: SubscriptionRow, event: AidVoucherEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const signature = signWebhookPayload(payload, sub.secret);

    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      if (RETRY_DELAYS_MS[i] > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
      }
      const attempt = i + 1;
      try {
        const resp = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [WEBHOOK_SIGNATURE_HEADER]: signature,
            'x-stellaraid-event': event.type,
          },
          body: payload,
        });
        await this.logAttempt(sub.id, event, attempt, resp.status, resp.ok, null);
        if (resp.ok) return;
      } catch (e) {
        await this.logAttempt(sub.id, event, attempt, null, false, String(e));
      }
    }
    this.logger.warn(`webhook delivery to ${sub.url} exhausted retries for event ${event.id}`);
  }

  private async logAttempt(
    subscriptionId: string,
    event: AidVoucherEvent,
    attempt: number,
    statusCode: number | null,
    ok: boolean,
    error: string | null,
  ): Promise<void> {
    await this.prisma.webhookDelivery
      .create({
        data: {
          subscriptionId,
          eventId: event.id,
          eventType: event.type,
          attempt,
          statusCode: statusCode ?? undefined,
          ok,
          error: error ?? undefined,
        },
      })
      .catch((e: unknown) => this.logger.warn(`failed to log webhook delivery attempt: ${e}`));
  }
}
