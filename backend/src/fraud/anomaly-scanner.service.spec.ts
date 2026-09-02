import { AuditLogService } from '../audit/audit-log.service';
import { EventEngineService } from '../events/event-engine.service';
import { AidVoucherEvent, IssuedEvent, RedeemedEvent } from '../events/event.types';
import { AnomalyScannerService } from './anomaly-scanner.service';
import { OracleClientService } from './oracle-client.service';

function issued(voucherId: number, recipient: string, atMs: number): IssuedEvent {
  return {
    id: `evt-issued-${voucherId}-${atMs}`,
    type: 'issued',
    ledger: 1,
    ledgerClosedAt: new Date(atMs).toISOString(),
    txHash: 'tx',
    contractId: 'CCONTRACT',
    data: { voucherId, recipient, amount: '100' },
  };
}

function redeemed(voucherId: number, merchant: string, atMs: number): RedeemedEvent {
  return {
    id: `evt-redeemed-${voucherId}-${atMs}`,
    type: 'redeemed',
    ledger: 1,
    ledgerClosedAt: new Date(atMs).toISOString(),
    txHash: 'tx',
    contractId: 'CCONTRACT',
    data: { voucherId, merchant, amount: '10', spent: '10' },
  };
}

describe('AnomalyScannerService', () => {
  const ORIGINAL_ENV = process.env;
  let handler: (event: AidVoucherEvent) => void;
  let engine: Pick<EventEngineService, 'onEvent'>;
  let oracle: {
    isConfigured: boolean;
    flagMerchant: jest.Mock;
    postAnomaly: jest.Mock;
  };
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Deterministic thresholds regardless of the real .env.example defaults.
    process.env.FRAUD_RAPID_REDEMPTION_SECONDS = '30';
    process.env.FRAUD_MERCHANT_VELOCITY_WINDOW_MS = '60000';
    process.env.FRAUD_MERCHANT_VELOCITY_THRESHOLD = '3';
    process.env.FRAUD_RECIPIENT_FANOUT_WINDOW_MS = '3600000';
    process.env.FRAUD_RECIPIENT_FANOUT_THRESHOLD = '3';
    process.env.FRAUD_FLAG_COOLDOWN_MS = '600000';

    engine = {
      onEvent: jest.fn((h: (event: AidVoucherEvent) => void) => {
        handler = h;
        return () => {};
      }),
    };
    oracle = {
      isConfigured: true,
      flagMerchant: jest.fn().mockResolvedValue({ hash: 'x', status: 'PENDING' }),
      postAnomaly: jest.fn().mockResolvedValue({ hash: 'x', status: 'PENDING' }),
    } as never;
    auditLog = { record: jest.fn().mockResolvedValue(undefined) } as never;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function makeScanner(): AnomalyScannerService {
    const scanner = new AnomalyScannerService(
      engine as EventEngineService,
      oracle as unknown as OracleClientService,
      auditLog as unknown as AuditLogService,
    );
    scanner.onModuleInit();
    return scanner;
  }

  it('flags rapid redemption (redeemed seconds after issuance)', async () => {
    makeScanner();
    const t0 = Date.now();
    handler(issued(1, 'GRECIPIENT', t0));
    await handler(redeemed(1, 'GMERCHANT', t0 + 5_000) as unknown as AidVoucherEvent);
    // handler is async under the hood (fire-and-forget `void this.handle`);
    // flush microtasks.
    await new Promise((r) => setImmediate(r));

    expect(oracle.postAnomaly).toHaveBeenCalledWith(1, expect.any(Number), 'rapid_redemption');
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fraud.anomaly_detected', entityId: '1' }),
    );
  });

  it('does not flag a redemption well after issuance', async () => {
    makeScanner();
    const t0 = Date.now();
    handler(issued(2, 'GRECIPIENT', t0));
    handler(redeemed(2, 'GMERCHANT', t0 + 120_000));
    await new Promise((r) => setImmediate(r));

    expect(oracle.postAnomaly).not.toHaveBeenCalled();
  });

  it('flags a merchant once redemption velocity crosses the threshold', async () => {
    makeScanner();
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      handler(redeemed(100 + i, 'GBUSYMERCHANT', t0 + i * 1000));
    }
    await new Promise((r) => setImmediate(r));

    expect(oracle.flagMerchant).toHaveBeenCalledTimes(1);
    expect(oracle.flagMerchant).toHaveBeenCalledWith('GBUSYMERCHANT', 'merchant_velocity');
  });

  it('flags recipient fan-out once issuance count crosses the threshold', async () => {
    makeScanner();
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      handler(issued(200 + i, 'GFARMER', t0 + i * 1000));
    }
    await new Promise((r) => setImmediate(r));

    expect(oracle.postAnomaly).toHaveBeenCalledTimes(1);
    expect(oracle.postAnomaly).toHaveBeenCalledWith(202, expect.any(Number), 'recipient_fanout');
  });

  it('still records to AuditLog even when the oracle is not configured', async () => {
    oracle.isConfigured = false;
    makeScanner();
    const t0 = Date.now();
    handler(issued(3, 'GRECIPIENT', t0));
    handler(redeemed(3, 'GMERCHANT', t0 + 1_000));
    await new Promise((r) => setImmediate(r));

    expect(auditLog.record).toHaveBeenCalled();
    expect(oracle.postAnomaly).not.toHaveBeenCalled();
  });

  it('a scoring error for one event never throws out of the subscriber', async () => {
    makeScanner();
    // A malformed event (missing data) should be swallowed, not thrown.
    const bad = { type: 'issued', id: 'bad', ledgerClosedAt: 'not-a-date' } as unknown as AidVoucherEvent;
    expect(() => handler(bad)).not.toThrow();
  });
});
