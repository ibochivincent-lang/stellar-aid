/**
 * Typed shapes for `aid_voucher` contract events. This is the "ABI registry"
 * equivalent for stellar-aid — scoped to the one contract this project ships
 * rather than a generic multi-contract registry, since that's all it needs.
 *
 * Topic/data shapes here must stay in sync with the `env.events().publish(...)`
 * calls in `contracts/src/lib.rs`. If a topic name below stops matching what
 * the contract emits, `decodeContractEvent` will just fall through to the
 * `unknown` case rather than silently misparse — see event-decoder.ts.
 */

export interface AidEventEnvelope<Name extends string, Data> {
  /** Stable id from Soroban RPC — `<ledger>-<index>` shaped, safe to dedupe on. */
  id: string;
  type: Name;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
  data: Data;
}

export type InitializeEvent = AidEventEnvelope<'initialize', { admin: string }>;

export type MerchantEvent = AidEventEnvelope<
  'merchant',
  { merchant: string; active: boolean }
>;

export type IssuedEvent = AidEventEnvelope<
  'issued',
  { voucherId: number; recipient: string; amount: string }
>;

export type RedeemedEvent = AidEventEnvelope<
  'redeemed',
  { voucherId: number; merchant: string; amount: string; spent: string }
>;

export type BurnedEvent = AidEventEnvelope<
  'burned',
  { voucherId: number; remaining: string }
>;

export type DelegateEvent = AidEventEnvelope<
  'delegate',
  { voucherId: number; delegate: string; active: boolean }
>;

export type FrozenEvent = AidEventEnvelope<
  'frozen',
  { voucherId: number; frozen: boolean }
>;

export type UnknownEvent = AidEventEnvelope<'unknown', { topics: unknown[]; raw: unknown }>;

export type AidVoucherEvent =
  | InitializeEvent
  | MerchantEvent
  | IssuedEvent
  | RedeemedEvent
  | BurnedEvent
  | DelegateEvent
  | FrozenEvent
  | UnknownEvent;

export const KNOWN_EVENT_TYPES = [
  'initialize',
  'merchant',
  'issued',
  'redeemed',
  'burned',
  'delegate',
  'frozen',
] as const;
