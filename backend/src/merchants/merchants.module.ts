import { Module } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { PrismaService } from '../common/prisma.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService, PrismaService, AdminGuard],
  exports: [MerchantsService],
})
export class MerchantsModule {}
