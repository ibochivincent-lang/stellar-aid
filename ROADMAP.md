# Roadmap

This tracks StellarAID's path from the current backend/contract slice to the
system described in the README. Phases roughly follow the Drips Wave issue
breakdown in `docs/issues.md`; point labels (`trivial-100` / `medium-150` /
`high-200`) are noted where an item maps directly to one.

## Phase 0 — Core voucher lifecycle (done)

- [x] `aid_voucher` Soroban contract: `issue_voucher`, `redeem`, `burn_expired`,
      `freeze_voucher`, delegate support, checked arithmetic.
- [x] Re-entrant-safe `initialize` (rejects being called twice).
- [x] Merchant registration and active/inactive toggling.
- [x] Merchant category/region scoping enforced on-chain in `can_redeem`
      (`set_merchant_scope`, `merchant_info`).
- [x] NestJS backend: voucher issue/spend/burn against Soroban RPC, Prisma
      read model, admin guard.
- [x] Merchant admin API mirroring the contract's merchant calls.
- [x] Event delivery: Soroban RPC event poller → typed decoder → SSE stream
      (`GET /api/events/stream`) and HMAC-signed webhooks
      (`POST /api/webhooks`), with a resume cursor per contract.
- [x] Request validation (class-validator DTOs) on every mutating endpoint.
- [x] Security baseline: `helmet`, per-IP rate limiting, audit log for every
      admin action (`AuditLog` table + `AuditLogService`).
- [x] Unit tests for the pure/security-critical pieces (webhook signing, the
      SSRF guard, event decoding, the admin guard) and CI running them on
      every push/PR alongside `cargo test` and a wasm32 release build.

## Phase 1 — Privacy and compliance primitives (`high-200` / `medium-150`)

Vouchers currently carry their amount and category in the clear on Prisma
and in contract storage. The README's "Why Stellar 2026" table commits to
private-by-default aid — this phase is what makes that true rather than
aspirational:

- [ ] Confidential Token vault integration (`confidential_vault.cls`):
      deposit USDC → confidential wrapper, private transfer, auditor view-key
      disclosure.
- [ ] ZK eligibility verifier (`eligibility_zk.cls`): Noir circuit + BN254
      in-contract verification, so eligibility is provable without exposing
      the underlying KYC data.
- [ ] Quorum Freeze incident handler: freeze / unfreeze / allowlist hooked to
      protocol-level fraud quarantine, replacing today's contract-only
      `freeze_voucher`.
- [ ] Precise TTL v2 policy per voucher/program (today's expiry is a single
      timestamp field; this makes lifetime a first-class per-program policy).
- [ ] Auditor view-key disclosure service — a real selective-disclosure API,
      not just "auditors can read the Prisma read model."

## Phase 2 — Onboarding and client apps (`high-200`)

Nothing in `frontend/` exists yet beyond the events React hook package this
phase would sit alongside:

- [ ] SEP-45 passkey embedded-wallet onboarding (invite → WebAuthn → smart
      account deploy) — citizens should never need a seed phrase.
- [ ] `citizen_account` smart account: CAP-71 auth delegation, guardians,
      spending limits.
- [ ] Citizen wallet PWA: claim and redeem vouchers.
- [ ] Merchant POS screen: scan a voucher QR, submit a `redeem` call.
- [ ] NGO/donor auditor dashboard: programs, budgets, view-key audit trail,
      built on the Phase 0 event stream and Phase 1 disclosure API.
- [ ] Published `frontend/packages/use-stellar-aid-events` React hook
      package (SSE client wrapping `GET /api/events/stream`).

## Phase 3 — Agent and platform hardening (`medium-150` / `trivial-100`)

- [ ] x402 paid aid-analytics endpoint: real 402-payment-required flow per
      request (currently a stub controller with no payment gate).
- [ ] CAP-85 external-executable fleet upgrades — patch every deployed
      campaign contract from one upgrade transaction instead of redeploying
      each program individually.
- [ ] Idempotency keys on write endpoints (`issue`, `spend`, `burn`), so a
      retried request from a flaky client can't double-issue or double-spend.
- [ ] Replace `AdminGuard`'s shared-secret header with real admin auth (JWT
      or SEP-45-based), once Phase 2's passkey flow exists to build it on.
- [ ] Muxed strkey helpers, XDR builders, and shared canonical test
      fixtures for the contract test suite.

## Phase 4 — Mainnet pilot

- [ ] Run a scoped pilot program end-to-end on mainnet with a real NGO/
      donor: budget, a small merchant set, real citizens, real settlement in
      USDC.
- [ ] Load-test the event poller and webhook fan-out against pilot volume;
      confirm the `EventCursor` resume logic holds up across a real restart.
- [ ] External security review of the contract and the admin/auth surface
      before scaling past the pilot's budget cap.

---

Anything not yet checked off is unstarted or partial, not "broken" — see
`docs/issues.md` for the Wave-ready issue breakdown these map to, and open
an issue against a specific unchecked item before starting work on it so
effort doesn't collide.
