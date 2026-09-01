import type { rpc as SorobanRpc } from '@stellar/stellar-sdk';

// `@stellar/stellar-sdk`'s CJS build transitively requires an ESM-only
// dependency (`@noble/hashes`), which ts-jest can't transform through
// node_modules by default and crashes the whole suite on import. This
// decoder only calls `scValToNative` — never anything from the RPC client —
// so mock just that one function rather than dragging the whole SDK (and
// its broken import chain) into the test process. `raw.topic`/`raw.value`
// below are then just the plain JS values the decoder should end up with,
// since "decoding" is a no-op under this mock.
jest.mock('@stellar/stellar-sdk', () => ({
  scValToNative: (v: unknown) => v,
}));

import { decodeContractEvent } from './event-decoder';

/** Builds a minimal fake RPC event response shaped like a real one. */
function fakeEvent(topics: unknown[], value: unknown[] | unknown) {
  return {
    id: 'evt-1',
    ledger: 100,
    ledgerClosedAt: '2026-01-01T00:00:00Z',
    txHash: 'deadbeef',
    contractId: { toString: () => 'CCONTRACT' },
    topic: topics,
    value,
    // Other `EventResponse` fields the decoder doesn't read.
  } as unknown as SorobanRpc.Api.EventResponse;
}

describe('decodeContractEvent', () => {
  it('decodes an issued event', () => {
    const raw = fakeEvent(['issued', 7], ['GRECIPIENT', 500n]);
    const event = decodeContractEvent(raw);
    expect(event.type).toBe('issued');
    if (event.type === 'issued') {
      expect(event.data.voucherId).toBe(7);
      expect(event.data.recipient).toBe('GRECIPIENT');
      expect(event.data.amount).toBe('500');
    }
  });

  it('decodes a redeemed event', () => {
    const raw = fakeEvent(['redeemed', 3], ['GMERCHANT', 200n, 300n]);
    const event = decodeContractEvent(raw);
    expect(event.type).toBe('redeemed');
    if (event.type === 'redeemed') {
      expect(event.data.voucherId).toBe(3);
      expect(event.data.merchant).toBe('GMERCHANT');
      expect(event.data.amount).toBe('200');
      expect(event.data.spent).toBe('300');
    }
  });

  it('decodes a merchant event', () => {
    const raw = fakeEvent(['merchant'], ['GMERCHANT', true]);
    const event = decodeContractEvent(raw);
    expect(event.type).toBe('merchant');
    if (event.type === 'merchant') {
      expect(event.data.merchant).toBe('GMERCHANT');
      expect(event.data.active).toBe(true);
    }
  });

  it('falls back to an unknown event for an unrecognized topic', () => {
    const raw = fakeEvent(['some_future_event', 1], ['x']);
    const event = decodeContractEvent(raw);
    expect(event.type).toBe('unknown');
  });

  it('never throws, even on malformed input', () => {
    const raw = {
      id: 'evt-bad',
      ledger: 1,
      ledgerClosedAt: 'x',
      txHash: 'x',
      contractId: null,
      topic: null,
      value: null,
    } as unknown as SorobanRpc.Api.EventResponse;
    expect(() => decodeContractEvent(raw)).not.toThrow();
    expect(decodeContractEvent(raw).type).toBe('unknown');
  });
});
