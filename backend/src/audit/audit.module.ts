import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditLogService } from './audit-log.service';

/**
 * Global so every module that performs an admin action can inject
 * `AuditLogService` without each declaring its own `PrismaService`
 * instance just for this — mirrors how `StellarModule` is already global.
 */
@Global()
@Module({
  providers: [AuditLogService, PrismaService],
  exports: [AuditLogService],
})
export class AuditModule {}
