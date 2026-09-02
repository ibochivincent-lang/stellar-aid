# Contributing to StellarAID

Thanks for looking at this. StellarAID is built for the Drips Stellar Wave
Program, so issues are sized against the Wave complexity model
(`trivial-100` / `medium-150` / `high-200`) — see `docs/issues.md` for the
current breakdown and `ROADMAP.md` for how issues map to phases.

## Before you start

- Check `docs/issues.md` and `ROADMAP.md` for an existing item covering what
  you want to work on, and open (or claim) an issue for it before starting —
  this avoids two people building the same thing.
- For anything not already listed, open an issue describing what you'd add
  and why before sending a PR, so the scope is agreed first.

## Project layout

```
stellar-aid/
├── contracts/   # Soroban smart contract (Rust)
├── backend/     # NestJS API + event delivery + webhooks
├── frontend/    # Client SDKs (early)
└── docs/        # Wave issue breakdown + design docs for not-yet-built items
```

## Working on the contract (`contracts/`)

```bash
cd contracts
cargo test                                        # unit tests
cargo fmt --all                                    # format before committing
cargo build --target wasm32-unknown-unknown --release
```

CI runs `cargo fmt --all -- --check`, `cargo test`, and the wasm32 release
build on every push and PR — run all three locally before opening a PR.

Notes specific to this contract:

- Error enums need `#[contracterror]`, not `#[contracttype]`.
- Tests exercise the contract through its generated `Client` (via
  `env.register(...)`), not the contract struct directly — `try_*` methods
  only exist on the `Client`.
- Storage-affecting entry points return `Result<(), VoucherError>` rather
  than panicking, so callers (and tests) get a typed error back.

## Working on the backend (`backend/`)

```bash
cd backend
npm install
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, ADMIN_USERNAME/
                           # ADMIN_PASSWORD_HASH, Stellar keys — see the
                           # comments in .env.example for how to generate each
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

Before opening a PR:

```bash
npx tsc --noEmit    # typecheck
npm run lint         # eslint
npm test             # jest (unit)
npm run test:e2e     # jest (e2e — a real Nest app, Prisma/Stellar mocked)
npm run build        # nest build
```

CI runs the same five steps. A few conventions worth knowing:

- Request bodies are validated with `class-validator` DTOs
  (`src/**/dto/*.dto.ts`) — add one for any new mutating endpoint rather
  than trusting the raw body.
- Admin-only endpoints use `@UseGuards(JwtAuthGuard, RolesGuard)` +
  `@Roles('ADMIN')` (see `src/auth/` — `POST /api/auth/login` issues the
  bearer token). This is still an interim single-operator login, not real
  multi-user auth — see `ROADMAP.md` Phase 3 for what replaces it.
- A fund-moving write that's unsafe to accidentally repeat (issuing a
  voucher, so far) takes `@UseInterceptors(IdempotencyInterceptor)` and
  honors an `Idempotency-Key` header — see `src/common/idempotency.interceptor.ts`.
- Any admin action that changes state should call `AuditLogService.record(...)`
  (see `src/audit/`) — it's fire-and-forget and must never block or fail the
  action it's logging.
- Pure, security-relevant logic (webhook signing/verification, the SSRF
  guard, event decoding, the auth guards, the fraud-scanner heuristics in
  `src/fraud/heuristics.ts`) should stay unit-testable without a database or
  network — see the existing `*.spec.ts` files for the pattern. The e2e
  suite (`test/app.e2e-spec.ts`) is the place for "does the HTTP/auth wiring
  actually work end to end" — it overrides `PrismaService` with a
  lightweight fake rather than hitting a real database.
- A server-signed on-chain identity that isn't the treasury/admin key (the
  anomaly oracle's `AID_ORACLE_SIGNING_SECRET` is the first example — see
  `StellarService.signAndSubmitAs` and `src/fraud/oracle-client.service.ts`)
  should stay a **separate** key with the narrowest role the contract can
  grant it, never the treasury key reused with an application-level
  permission check. The point is that a bug or compromise in that service
  can only do what the contract lets that specific key's role do — the
  contract is the enforcement boundary, not the calling code. Follow this
  pattern for any new automated/background signer rather than adding
  another `if (caller === treasury)`-style check in TypeScript.
- Anything importing `@stellar/stellar-sdk` in a `*.spec.ts` needs either
  `jest.mock('@stellar/stellar-sdk', ...)` (see `event-decoder.spec.ts`) or
  to rely on the `transformIgnorePatterns` entry in `package.json`'s `jest`
  config / `test/jest-e2e.json` (already covers `@stellar`, `@noble`,
  `uint8array-extras`) — its CJS build transitively pulls in ESM-only
  dependencies that crash Jest's default transform.

## Commit / PR style

- Keep PRs scoped to one issue where possible — easier to review, easier to
  size against the Wave point labels.
- Explain *why* in the PR description, not just what changed; several
  design decisions in this codebase (the interim single-operator JWT login,
  the fire-and-forget audit log, the SSRF guard's known DNS-rebinding gap)
  are deliberate trade-offs, not oversights — if you're changing one of
  those, say what replaces the trade-off and why.
