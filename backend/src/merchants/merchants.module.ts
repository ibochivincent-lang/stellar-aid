import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService, PrismaService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
