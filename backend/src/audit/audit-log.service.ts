import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Writes to the `AuditLog` table. The model has existed in the Prisma
 * schema since the start of this project, but nothing ever called it —
 * every admin action (issuing a voucher, burning one, registering a
 * merchant, adding a webhook subscriber) happened with no durable record of
 * which admin did it or when. This is the writer that was missing.
 *
 * Deliberately fire-and-forget from the caller's perspective: an audit
 * write failing must never block or fail the underlying admin action, so
 * every call site should treat `record` as best-effort (it already
 * swallows its own errors, logging instead of throwing).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog
      .create({
        data: {
          actor: entry.actor,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
        },
      })
      .catch((e: unknown) => this.logger.warn(`failed to write audit log entry: ${e}`));
  }
}
