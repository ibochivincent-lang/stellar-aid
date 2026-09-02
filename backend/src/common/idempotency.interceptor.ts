import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from './prisma.service';

const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Makes a write endpoint safe to retry: a client that resends the same
 * request (e.g. after a timeout where it never saw the response, but the
 * server-side on-chain submission actually went through) with the same
 * `Idempotency-Key` header gets back the ORIGINAL response instead of
 * triggering a second on-chain call — issuing a voucher twice for one
 * intended action would double-lock treasury funds.
 *
 * No header present → behaves as if this interceptor weren't there at all
 * (existing callers, and non-money-moving endpoints, are unaffected).
 *
 * This is a best-effort cache, not a distributed lock: two concurrent
 * requests with the same key can both slip past the "have I seen this
 * before" check and both execute — the second `IdempotencyKey` insert then
 * just fails its primary-key constraint, which is swallowed rather than
 * surfaced as an error to either caller. Good enough for the common case
 * (a client retrying after a dropped response), not a guarantee against a
 * client firing the same key concurrently on purpose.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      return next.handle();
    }

    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });
    if (existing) {
      return of(JSON.parse(existing.responseJson));
    }

    return next.handle().pipe(
      tap((response: unknown) => {
        void this.prisma.idempotencyKey
          .create({ data: { key, responseJson: JSON.stringify(response) } })
          .catch(() => {
            // Lost a race with a concurrent identical request, or the
            // response wasn't JSON-serializable — either way, this cache
            // is best-effort and must never fail the actual request.
          });
      }),
    );
  }
}
