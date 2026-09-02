import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AnomalyScannerService } from './anomaly-scanner.service';
import { OracleClientService } from './oracle-client.service';

/**
 * Wires up the anomaly scanner (Item 2 of the AI feature set — see
 * ROADMAP.md). `StellarService` and `AuditLogService` come from
 * `StellarModule`/`AuditModule`, both `@Global()` and already imported in
 * `AppModule`, so this module only needs its own providers plus
 * `EventsModule` for `EventEngineService`.
 *
 * No controller here on purpose: this module has no HTTP surface of its
 * own — it's a background subscriber. `OracleClientService` is exported in
 * case a future admin endpoint wants to expose oracle status/manual
 * flag/unflag actions, but nothing currently imports it outside this
 * module.
 */
@Module({
  imports: [EventsModule],
  providers: [OracleClientService, AnomalyScannerService],
  exports: [OracleClientService],
})
export class FraudModule {}
