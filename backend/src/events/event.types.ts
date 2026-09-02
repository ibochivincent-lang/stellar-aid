/**
 * Typed shapes for `aid_voucher` contract events. This is the "ABI registry"
 * equivalent for stellar-aid — scoped to the one contract this project ships
 * rather than a generic multi-contract registry, since that's all it needs.
 *
 * Topic/data shapes here must stay in sync with the `#[contractevent]` structs
 * in `contracts/src/lib.rs`. Every one of those is declared with
 * `data_format = "vec"`, so its non-topic fields still arrive as a positional
 * array in declaration order — matching what `decodeContractEvent` expects —
 * rather than the SDK's default keyed map. If a topic name below stops
 * matching what the contract emits, `decodeContractEvent` will just fall
 * through to the `unknown` case rather than silently misparse — see
 * event-decoder.ts.
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

/** Admin granted/revoked the anomaly-oracle role — see `set_oracle` in contracts/src/lib.rs. */
export type OracleSetEvent = AidEventEnvelope<'oracle_set', { oracle: string; active: boolean }>;

/**
 * An oracle proposed flagging a merchant — purely informational on-chain
 * (see the "Anomaly oracle" module doc in contracts/src/lib.rs): nothing
 * about the merchant changes until an admin separately calls
 * `set_merchant`. `backend/src/fraud/` is what turns this signal into
 * that admin action, when it decides to.
 */
export type FlaggedEvent = AidEventEnvelope<'flagged', { merchant: string; oracle: string; reason: string }>;

/** An oracle posted a 0-100 anomaly score for a voucher — also purely informational. */
export type AnomalyEvent = AidEventEnvelope<
  'anomaly',
  { voucherId: number; oracle: string; score: number; reason: string }
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
  | OracleSetEvent
  | FlaggedEvent
  | AnomalyEvent
  | UnknownEvent;

export const KNOWN_EVENT_TYPES = [
  'initialize',
  'merchant',
  'issued',
  'redeemed',
  'burned',
  'delegate',
  'frozen',
  'oracle_set',
  'flagged',
  'anomaly',
] as const;
