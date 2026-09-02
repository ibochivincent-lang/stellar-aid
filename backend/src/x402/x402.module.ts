import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { X402Controller } from './x402.controller';
import { X402VerificationService } from './x402-verification.service';

@Module({
  imports: [AiModule],
  controllers: [X402Controller],
  providers: [X402VerificationService],
})
export class X402Module {}