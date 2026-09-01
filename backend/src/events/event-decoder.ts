import { rpc as SorobanRpc, scValToNative } from '@stellar/stellar-sdk';
import {
  AidVoucherEvent,
  BurnedEvent,
  DelegateEvent,
  FrozenEvent,
  InitializeEvent,
  IssuedEvent,
  MerchantEvent,
  RedeemedEvent,
  UnknownEvent,
} from './event.types';

/** Renders an i128/u128 (bigint after scValToNative) as a decimal string. */
function amountToString(v: unknown): string {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(v);
  return String(v);
}

function base(
  raw: SorobanRpc.Api.EventResponse,
): Pick<UnknownEvent, 'id' | 'ledger' | 'ledgerClosedAt' | 'txHash' | 'contractId'> {
  return {
    id: raw.id,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    txHash: raw.txHash,
    contractId: raw.contractId?.toString() ?? '',
  };
}

/**
 * Decodes one Soroban RPC event into a typed `AidVoucherEvent`. Topic[0] is
 * always the event name `Symbol` the contract published; topic[1] (when
 * present) is the voucher id. Everything else comes from `value`, which
 * Soroban encodes as a tuple matching the `(a, b, ...)` the contract passed
 * to `env.events().publish((...topics), (...data))`.
 *
 * Returns an `unknown`-typed event (never throws) for anything that doesn't
 * match a known shape — a topic from a future contract version, for
 * instance — so one unrecognized event can't take down the poller.
 */
export function decodeContractEvent(raw: SorobanRpc.Api.EventResponse): AidVoucherEvent {
  try {
    const topics = raw.topic.map((t) => scValToNative(t));
    const name = topics[0];
    const value = scValToNative(raw.value);
    const data = Array.isArray(value) ? value : [value];

    switch (name) {
      case 'initialize': {
        const [admin] = data as [string];
        return { ...base(raw), type: 'initialize', data: { admin } } satisfies InitializeEvent;
      }
      case 'merchant': {
        const [merchant, active] = data as [string, boolean];
        return {
          ...base(raw),
          type: 'merchant',
          data: { merchant, active },
        } satisfies MerchantEvent;
      }
      case 'issued': {
        const voucherId = Number(topics[1]);
        const [recipient, amount] = data as [string, unknown];
        return {
          ...base(raw),
          type: 'issued',
          data: { voucherId, recipient, amount: amountToString(amount) },
        } satisfies IssuedEvent;
      }
      case 'redeemed': {
        const voucherId = Number(topics[1]);
        const [merchant, amount, spent] = data as [string, unknown, unknown];
        return {
          ...base(raw),
          type: 'redeemed',
          data: {
            voucherId,
            merchant,
            amount: amountToString(amount),
            spent: amountToString(spent),
          },
        } satisfies RedeemedEvent;
      }
      case 'burned': {
        const voucherId = Number(topics[1]);
        const [remaining] = data as [unknown];
        return {
          ...base(raw),
          type: 'burned',
          data: { voucherId, remaining: amountToString(remaining) },
        } satisfies BurnedEvent;
      }
      case 'delegate': {
        const voucherId = Number(topics[1]);
        const [delegate, active] = data as [string, boolean];
        return {
          ...base(raw),
          type: 'delegate',
          data: { voucherId, delegate, active },
        } satisfies DelegateEvent;
      }
      case 'frozen': {
        const voucherId = Number(topics[1]);
        const [frozen] = data as [boolean];
        return {
          ...base(raw),
          type: 'frozen',
          data: { voucherId, frozen },
        } satisfies FrozenEvent;
      }
      default:
        return { ...base(raw), type: 'unknown', data: { topics, raw: value } } satisfies UnknownEvent;
    }
  } catch (e) {
    return {
      ...base(raw),
      type: 'unknown',
      data: { topics: [], raw: `decode error: ${e}` },
    } satisfies UnknownEvent;
  }
}
