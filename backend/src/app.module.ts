import { Module } from '@nestjs/common';
import { VouchersModule } from './vouchers/vouchers.module';
import { X402Module } from './x402/x402.module';

@Module({
  imports: [VouchersModule, X402Module],
})
export class AppModule {}
