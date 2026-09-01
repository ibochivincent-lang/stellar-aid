import { Module } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { PrismaService } from '../common/prisma.service';
import { VouchersService } from './vouchers.service';
import { VouchersController } from './vouchers.controller';

@Module({
  controllers: [VouchersController],
  providers: [VouchersService, PrismaService, AdminGuard],
  exports: [VouchersService],
})
export class VouchersModule {}
