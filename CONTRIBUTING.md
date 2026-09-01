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
└── docs/        # Wave issue breakdown
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
cp .env.example .env      # fill in DATABASE_URL, ADMIN_API_KEY, Stellar keys
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

Before opening a PR:

```bash
npx tsc --noEmit    # typecheck
npm run lint         # eslint
npm test             # jest
npm run build        # nest build
```

CI runs the same four steps. A few conventions worth knowing:

- Request bodies are validated with `class-validator` DTOs
  (`src/**/dto/*.dto.ts`) — add one for any new mutating endpoint rather
  than trusting the raw body.
- Admin-only endpoints use `@UseGuards(AdminGuard)` (a shared-secret header,
  see `src/common/admin.guard.ts` for why, and `ROADMAP.md` Phase 3 for
  what replaces it).
- Any admin action that changes state should call `AuditLogService.record(...)`
  (see `src/audit/`) — it's fire-and-forget and must never block or fail the
  action it's logging.
- Pure, security-relevant logic (webhook signing/verification, the SSRF
  guard, event decoding) should stay unit-testable without a database or
  network — see the existing `*.spec.ts` files for the pattern.

## Commit / PR style

- Keep PRs scoped to one issue where possible — easier to review, easier to
  size against the Wave point labels.
- Explain *why* in the PR description, not just what changed; several
  design decisions in this codebase (the admin guard's shared secret, the
  fire-and-forget audit log, the SSRF guard's known DNS-rebinding gap) are
  deliberate trade-offs, not oversights — if you're changing one of those,
  say what replaces the trade-off and why.
