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
      read model.
- [x] Merchant admin API mirroring the contract's merchant calls.
- [x] Event delivery: Soroban RPC event poller → typed decoder → SSE stream
      (`GET /api/events/stream`) and HMAC-signed webhooks
      (`POST /api/webhooks`), with a resume cursor per contract.
- [x] Request validation (class-validator DTOs) on every mutating endpoint.
- [x] Security baseline: `helmet`, per-IP rate limiting, audit log for every
      admin action (`AuditLog` table + `AuditLogService`).
- [x] JWT + role-based admin auth (`POST /api/auth/login`, `JwtAuthGuard` +
      `RolesGuard` + `@Roles(...)`) — replaced the earlier static
      shared-secret header with short-lived, expiring tokens carrying a
      role claim. Still an interim single-operator login (env-configured
      username/bcrypt hash), not the real multi-user auth Phase 2's
      passkey flow will eventually provide.
- [x] Idempotency keys (`Idempotency-Key` header) on `POST /vouchers` —
      a retried issue request replays the original response instead of
      locking treasury funds for a second voucher.
- [x] `AidProgram.spentBudget` tracked in the read model: incremented on
      issue, given back on `burnExpired` — mirrors the contract's own
      refund-to-treasury behavior so "the money doesn't idle" is visible
      to anything reading the database, not just on-chain.
- [x] Unit tests for the pure/security-critical pieces (webhook signing,
      the SSRF guard, event decoding, JWT auth/role guards, the
      idempotency interceptor) plus an e2e suite (`npm run test:e2e`)
      exercising auth end-to-end through a real Nest app. CI runs all of
      it — `cargo fmt/test/build` and `tsc/lint/test/test:e2e/build` — on
      every push/PR.
- [x] Repo skeleton: `.gitignore`, initial git history, LICENSE,
      CONTRIBUTING.md, SECURITY.md.
- [x] Deployment path unblocked: initial Prisma migration committed
      (`backend/prisma/migrations/20260902004500_init/` — hand-written and
      verified by applying it directly against a real local Postgres with
      `psql`, since this environment can't reach `binaries.prisma.sh` to run
      `prisma migrate dev` itself; `prisma migrate deploy` on a real machine
      just applies it normally), `backend/Dockerfile` (multi-stage,
      `prisma migrate deploy && node dist/main` as its `CMD`), and a root
      `docker-compose.yml` (Postgres-with-pgvector + the backend, for local/
      offline dev). Full instructions — including the "no `CROP_CONTRACT_ID`/
      `TICKET_CONTRACT_ID` in this project, only `AID_VOUCHER_CONTRACT_ID`"
      correction, and why the container's self-migrating `CMD` is a
      single-instance-only choice — in `DEPLOYMENT.md`. Still open: a
      provider-specific CI deploy step (deliberately left unbuilt — depends
      on which host gets picked) and a dedicated health-check route (`GET
      /api/vouchers` stands in for one today).

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
      the underlying KYC data. AI-assisted eligibility screening ahead of
      the proof — score, then prove `score >= threshold` privately — is
      designed (not built; no Noir toolchain in this environment) in
      `docs/design/zk-ai-eligibility.md`, including the trust boundary a ZK
      proof can't cover (it proves the arithmetic, not that the AI scorer
      was fed true inputs) and why the AI scoring step must run on a
      citizen/caseworker-trusted device, never this backend.
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
- [ ] Agentic aid — NGO/auditor agents consuming x402 analytics and, once
      Phase 2's `citizen_account`/CAP-71 spending limits exist,
      agent-initiated spends bounded by protocol-enforced caps; merchant/
      citizen "receipt photo or voice note → confirmed redeem" intent
      parsing. Designed (not built) in `docs/design/agentic-aid.md`,
      including why agent-initiated spend specifically waits on CAP-71
      rather than a backend-enforced limit.
- [ ] Published `frontend/packages/use-stellar-aid-events` React hook
      package (SSE client wrapping `GET /api/events/stream`).

## Phase 3 — Agent and platform hardening (`medium-150` / `trivial-100`)

- [ ] x402 paid aid-analytics endpoint: real 402-payment-required flow per
      request — `X402VerificationService` and the 402/proof flow itself are
      built and shared across endpoints, but `/data/aid-summary`'s payload
      is still hardcoded placeholder data (see the `TODO(ROADMAP Phase
      1/3)` in `x402.controller.ts`).
- [x] Citizen AI assistant (`backend/src/ai/`): x402-gated, streamed
      (`POST /data/chat`, Server-Sent Events) RAG chat answering citizen
      questions ("what can I spend this voucher on", "when does it
      expire") from structured Prisma retrieval (never the raw amount/
      spent/balance fields — see `RedactionService.stripFinancialFields`)
      plus optional pgvector semantic search over indexed FAQ/policy text
      (`AI_ENABLE_VECTOR_SEARCH`, off by default — nothing ingests into it
      yet). Provider-agnostic (`AI_PROVIDER=openai|anthropic`) via
      `@langchain/core`; `@langchain/community`'s Postgres vectorstore was
      deliberately not used (deprecated upstream, no replacement) — pgvector
      access is hand-rolled over the `pg` package instead
      (`vector-store.service.ts`). Needs a real `OPENAI_API_KEY`/
      `ANTHROPIC_API_KEY` to actually answer anything; untested against a
      live model in this environment (no key available here) but the
      pipeline, redaction, and streaming plumbing are.
- [x] AI fraud/anomaly oracle (`backend/src/fraud/`): an off-chain scanner
      subscribes to the same `EventEngineService` stream webhook delivery
      already consumes, scores issued/redeemed events against explainable
      heuristics (rapid redemption after issuance, merchant redemption
      velocity, recipient voucher fan-out — `heuristics.ts`), and proposes
      findings on-chain through a new admin-gated oracle role
      (`set_oracle`/`is_oracle`/`flag_merchant`/`post_anomaly` in
      contracts/src/lib.rs, mirroring the requested "StellarCrop" oracle
      pattern) signed with a **separate** `AID_ORACLE_SIGNING_SECRET` key,
      never the treasury key (`StellarService.signAndSubmitAs`). The
      contract stays deterministic — the oracle role can only publish
      informational events, never move funds, freeze a voucher, or
      deactivate a merchant by itself ("AI proposes, admin decides," see
      the module doc above `set_oracle` in the contract). Every finding is
      also written to `AuditLog` regardless of whether the on-chain post
      succeeds. 4 new contract tests, unit tests for the heuristics and the
      scanner/oracle-client services.
- [ ] CAP-85 external-executable fleet upgrades — patch every deployed
      campaign contract from one upgrade transaction instead of redeploying
      each program individually.
- [ ] Extend idempotency-key coverage to `burn` and to real user-facing
      writes once those exist (issue already has it — see Phase 0).
- [ ] Replace the interim single-operator JWT login with real multi-user
      auth (SEP-45-based), once Phase 2's passkey flow exists to build it
      on — today's `AuthService` is one env-configured admin account, not
      a user table.
- [ ] Muxed strkey helpers, XDR builders, and shared canonical test
      fixtures for the contract test suite.
- [ ] Tighten `Voucher.voucherId` to `@unique` on its own — the schema's
      current `@@unique([programId, voucherId])` allows a collision the
      on-chain contract's single global `DataKey::Voucher(voucher_id)` key
      space doesn't (see the comment in `VouchersService.burnExpired`).

## Phase 4 — Mainnet pilot

- [ ] Run a scoped pilot program end-to-end on mainnet with a real NGO/
      donor: budget, a small merchant set, real citizens, real settlement in
      USDC.
- [ ] Load-test the event poller and webhook fan-out against pilot volume;
      confirm the `EventCursor` resume logic holds up across a real restart.
- [ ] External security review of the contract and the admin/auth surface
      before scaling past the pilot's budget cap.

## Phase 5 — Voice-backed recovery & duress protection (`high-200`, differentiator)

Explicitly sequenced *after* Phase 1 (Confidential Tokens) and Phase 2
(SEP-45 passkeys / CAP-71 smart accounts) — voice recovery has nothing to
rotate a signer onto without Phase 2's smart accounts, and duress "decoy
mode" is trivially disprovable without Phase 1's confidential balances.
Fully designed (no code — no on-device ML client exists in this repo yet
either) in `docs/design/voice-recovery-and-duress.md`, covering:

- [ ] §0 Voice stack foundation: on-device speaker-model enrollment
      (only a signed, non-reconstructable fingerprint ever reaches the
      server — raw audio and the reconstructable embedding never leave the
      device), random-digit challenge-response (closes recording-replay,
      the top practical attack), and a liveness/anti-spoofing check.
- [ ] §P1 Voice-backed recovery: a Shamir-split escrowed recovery shard
      gated on voice-verify + liveness + a time delay + a secondary
      channel (never voice alone); unlock triggers a CAP-71 signer
      rotation rather than exposing a seed; cold paper backup kept as an
      independent final fallback, never the sole factor either.
- [ ] §P2 Coercion protection: a separately-enrolled duress phrase
      triggers a 48-hour `emergency_lock` with **no early unlock via voice,
      ever** (only a pre-trusted device's passkey or a pre-registered
      duress delegate can end it early); optional decoy mode once
      Confidential Tokens exist; voice as a required second factor
      (alongside the passkey, not instead of it) on high-value redemptions.
- [ ] §P3 Hardening & compliance: guardian-gated recovery/duress for
      family/co-op custody, a ZK-attestable voice proof (same "prove a
      property without revealing the data" shape as the eligibility
      circuit — build after that one has shipped once), separately
      enrolled recovery vs. duress phrases so a coerced user's only escape
      hatch isn't guessable, field robustness across noisy/low-end mics
      and multiple languages, and GDPR/biometric-data compliance (consent,
      retention, real delete) reviewed by counsel before shipping to any
      covered users.

---

Anything not yet checked off is unstarted or partial, not "broken" — see
`docs/issues.md` for the Wave-ready issue breakdown these map to, and open
an issue against a specific unchecked item before starting work on it so
effort doesn't collide.

`docs/design/` holds written specs for items that are deliberately
design-only in this repo — not implemented, not stubbed, just documented —
because they depend on infrastructure this environment doesn't have
(a Noir toolchain, CAP-71 smart accounts, a frontend/mobile client):
`zk-ai-eligibility.md`, `agentic-aid.md`, and
`voice-recovery-and-duress.md`. Treat them as a target shape to build
toward, not a description of existing code.
