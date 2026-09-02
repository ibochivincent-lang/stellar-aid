import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { FraudModule } from './fraud/fraud.module';
import { MerchantsModule } from './merchants/merchants.module';
import { StellarModule } from './stellar/stellar.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { X402Module } from './x402/x402.module';

@Module({
  imports: [
    // Global default: 100 req / 60s per IP. Individual endpoints (e.g.
    // admin-guarded writes) can tighten this further with `@Throttle(...)`
    // if abuse shows up there specifically; this is the floor, not the
    // whole story — it does not replace JwtAuthGuard/RolesGuard on
    // privileged routes.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // `@Global()` modules (StellarModule, AuditModule, AuthModule) still
    // need to be imported at least once for Nest to register them at all —
    // being `@Global()` only controls whether OTHER modules must also
    // import them to see their exports, not whether they're wired up in
    // the first place. Neither StellarModule nor AuditModule was imported
    // anywhere before, so every service injecting StellarService
    // (VouchersService, MerchantsService) would have failed to resolve its
    // dependencies at bootstrap.
    StellarModule,
    AuditModule,
    AuthModule,
    VouchersModule,
    MerchantsModule,
    X402Module,
    EventsModule,
    WebhooksModule,
    FraudModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}