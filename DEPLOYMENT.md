# Deployment

How to get StellarAID's three independently-deployed pieces — the Soroban
contract, the Postgres read model, and the NestJS backend — running outside
this repo's dev environment, plus what a frontend deploy will need once
`frontend/` has an actual app in it (ROADMAP.md Phase 2).

Deploy order matters — each step below depends on the previous one's output:

1. **Database up** (Neon/Railway/Supabase/local Docker) → migrated.
2. **Contract deployed to testnet** → contract ID copied into the backend's env.
3. **Backend up** → pointed at the database and the deployed contract, `GET
   /api/vouchers` returns 200.
4. **Frontend up** (once it exists) → pointed at the backend, CORS opened for
   its origin.

Do these in order on a fresh environment — deploying the backend before the
contract ID exists just means restarting it once you have one.

## 1. Contracts — no hosting, deploy to the Stellar network itself

Soroban contracts don't run on a server you manage — once deployed, the
Stellar network itself is the runtime. Nothing to keep alive, no container,
no "the deploy went down" pager.

```bash
cargo install stellar-cli   # if you don't already have the `stellar` CLI
cd contracts
# soroban-sdk 26 requires wasm32v1-none on Rust 1.84+, not wasm32-unknown-unknown
cargo build --target wasm32v1-none --release
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_aid.wasm \
  --network testnet \
  --source <your-deployer-keypair>
```

(`stellar_aid.wasm`, not `stellar-aid.wasm` — Cargo turns the crate's
hyphenated package name, `stellar-aid` in `contracts/Cargo.toml`, into an
underscored artifact filename.)

- **Fund the deployer** first with the SDF testnet friendbot (free XLM —
  https://friendbot.stellar.org, or `stellar keys fund <address> --network
  testnet`) — `--source` needs an account that actually exists on-chain and
  can pay the (trivial) deploy fee.
- **Environments**: Futurenet (bleeding-edge protocol features, least
  stable) → Testnet (this project's default for dev — `.env.example`
  already points `STELLAR_HORIZON_URL`/`STELLAR_RPC_URL` at
  `*-testnet.stellar.org`) → Mainnet (final; deploying and calling a
  contract there costs real, but trivial, XLM network fees — not a hosting
  bill, since there's no host).
- `stellar contract deploy` prints a contract ID (`C...`). This repo has
  **one** contract (`aid_voucher`, in `contracts/src/lib.rs`) — save that ID
  into the backend's env as `AID_VOUCHER_CONTRACT_ID`. `.env.example` also
  has a placeholder for `USDC_TOKEN_CONTRACT_ID` (the USDC Stellar Asset
  Contract you're settling against — on testnet this is usually an existing
  well-known contract you look up rather than one you deploy yourself).
  There's no `CROP_CONTRACT_ID` or `TICKET_CONTRACT_ID` in this project —
  those are from a different Wave template; StellarAID only has the one
  voucher contract, at least until something in ROADMAP.md Phase 1
  (Confidential Tokens, ZK eligibility) ships as its own contract.
- The backend's `STELLAR_RPC_URL` (default `soroban-testnet.stellar.org`)
  is how it talks to whatever network you deployed to — switching networks
  later means updating `STELLAR_NETWORK_PASSPHRASE`/`STELLAR_RPC_URL`/
  `STELLAR_HORIZON_URL` together, not just the contract ID.

## 2. Database — PostgreSQL

| Provider | Fit | Notes |
| --- | --- | --- |
| Neon (recommended) | Dev + prod | Serverless PG, free tier, instant backups, `DATABASE_URL` just works |
| Railway | Dev + prod | Postgres plugin next to the backend service = same region |
| Supabase | Dev | Free Postgres + auth extras (StellarAID doesn't use Supabase auth — it has its own JWT login, see `backend/src/auth/`) |
| Local + Docker | First boot | `docker compose up` from the repo root — see below |

Whichever provider: this schema needs the **pgvector** extension (used by
`AiDocument.embedding` — the citizen AI assistant's optional semantic-search
layer, off by default via `AI_ENABLE_VECTOR_SEARCH`). Neon and Railway both
support it; check before committing to a provider if you plan to turn that
feature on. If your provider doesn't allow `CREATE EXTENSION` from an
application role, have an admin run `CREATE EXTENSION vector;` once before
migrating — the first migration tries to create it itself and will fail on
just that one statement otherwise (see the comment above `CREATE EXTENSION`
in `backend/prisma/migrations/20260902004500_init/migration.sql`).

```bash
# fill DATABASE_URL in backend/.env, then:
cd backend
npx prisma migrate deploy   # applies the committed migrations (production)
```

Migrations are now committed (`backend/prisma/migrations/`) — this used to
be a blocker (see "Blocks cleared" below); it isn't anymore. If you change
`schema.prisma` going forward, generate the new migration the normal way:

```bash
npx prisma migrate dev --name <what_changed>
```

`prisma migrate dev` (unlike `deploy`) needs a **shadow database** it can
create and drop freely, and needs network access to `binaries.prisma.sh` to
fetch the query-engine binary the first time — both fine on a real machine
or CI runner with normal egress, neither available in the sandboxed
environment this migration was originally authored in (see the note in that
migration's comment history if you're wondering why it's hand-verified
rather than generated-and-eyeballed the usual way: it was applied
statement-by-statement against a real local Postgres with `psql`, bypassing
the blocked engine binary, specifically to confirm it's correct SQL before
committing it).

### Local + Docker (first boot / offline dev)

```bash
cp backend/.env.example .env   # fill in JWT_SECRET, ADMIN_PASSWORD_HASH, STELLAR_SIGNING_SECRET at minimum
docker compose up --build
```

This starts Postgres (with pgvector already installed —
`pgvector/pgvector:pg16`) and the backend together (see the root
`docker-compose.yml`); the backend's container entrypoint runs `prisma
migrate deploy` before starting the API, so a fresh database is already
migrated by the time it's up. `GET http://localhost:3000/api/vouchers`
should return `[]` once both containers report healthy.

## 3. Backend — NestJS

| Provider | Why |
| --- | --- |
| Railway (recommended) | Docker-friendly, env vars + secrets UI, easy to run `prisma migrate deploy` in a start hook (this repo's `Dockerfile` already does — see below) |
| Render | Free starter tier, deploys straight from the repo |
| Fly.io | Global edge regions — worth it specifically if RPC polling latency to Soroban RPC matters for your deployment's region |
| DigitalOcean App Platform | Simple, no free tier |

`backend/Dockerfile` exists now (see "Blocks cleared" below) — a multi-stage
build (`deps` → `build` → `runtime`) that ends with `npx prisma migrate
deploy && node dist/main` as its `CMD`, so every container start
self-migrates before serving traffic; that's a deliberate choice for a
single-instance/rolling deploy, not something to enable if you ever run
multiple backend instances against the same database concurrently (two
containers racing to run migrations on boot is a real failure mode — in
that case, run `prisma migrate deploy` as a separate one-off release step
instead and drop it from the container's `CMD`).

Every environment (dev, staging, prod) needs the same shape of env, filled
per-environment from `backend/.env.example`:

- `DATABASE_URL` — from step 2.
- `STELLAR_SIGNING_SECRET` — the treasury/admin keypair's secret (never the
  same value across environments — a leaked testnet key is annoying, a
  leaked mainnet one moves real funds).
- `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` — see
  `.env.example`'s comments for how to generate the hash.
- `AID_VOUCHER_CONTRACT_ID`, `USDC_TOKEN_CONTRACT_ID` — from step 1, and
  specific to whichever network (`STELLAR_NETWORK`/`STELLAR_RPC_URL`) this
  environment points at — a testnet backend with a mainnet contract ID (or
  vice versa) fails every on-chain call.
- `STELLAR_RPC_URL` — `soroban-testnet.stellar.org` for testnet (the
  `.env.example` default); switch this (and `STELLAR_HORIZON_URL`,
  `STELLAR_NETWORK_PASSPHRASE`) together when moving to mainnet.
- Everything else in `.env.example` (x402, the AI assistant, the fraud
  oracle) is optional — the backend boots and the core voucher flow works
  with none of those set; they only gate their own specific features (see
  the comments above each block in `.env.example`).

Verify with `GET /api/vouchers` (200, `[]` on a fresh database — there's no
dedicated health-check route yet, this is the cheapest public endpoint that
proves the app booted and can reach Postgres) once deployed, then exercise
`POST /api/auth/login` with the configured admin credentials before
trusting the deploy — that call alone confirms `DATABASE_URL`, `JWT_SECRET`,
and the admin credential env vars are all correctly wired.

## 4. Frontend — static PWA (Vercel/Netlify/Cloudflare)

Not yet buildable — `frontend/` in this repo is currently just the planned
`use-stellar-aid-events` SSE hook package (ROADMAP.md Phase 2), not an app.
Once it exists:

- Vercel or Netlify: push the React/Vite app, get free TLS/HTTPS — this
  isn't a nice-to-have here specifically, WebAuthn/passkey (SEP-45, Phase 2)
  and the planned voice features
  (`docs/design/voice-recovery-and-duress.md`) both require a **secure
  context** (HTTPS or localhost) to get microphone/credential API access at
  all; a plain HTTP deploy would silently break both.
- `VITE_API_URL=https://your-backend-host/api` — point it at wherever step 3
  landed.
- Set the backend's `CORS_ORIGIN` to the frontend's real deployed origin —
  the backend already reads this from env (see `main.ts`); it defaults to
  `http://localhost:5173` for local dev in `.env.example` and needs
  updating per environment, same as everything else in this doc.

## Blocks cleared / still open

What used to block a real deploy, and where each stands now:

- [x] **Generate migrations** (`prisma migrate dev`) — committed as
      `backend/prisma/migrations/20260902004500_init/`. `prisma migrate
      deploy` now has something to apply; this was the first item on the
      original blocker list and is done.
- [x] **`Dockerfile` + `docker-compose.yml`** — both added (`backend/Dockerfile`,
      root `docker-compose.yml`). The compose file is for local/offline dev
      specifically (see step 2); it isn't what Railway/Render/Fly deploy
      from directly — they build from `backend/Dockerfile` on their own.
- [ ] **CI deploy step** — CI (`.github/workflows/ci.yml`) still only runs
      `test`/`build`/`lint` on push/PR; it doesn't deploy anywhere. Adding
      one is provider-specific (a Railway/Render/Fly CLI step gated on
      `main`, with that provider's deploy token as a repo secret) and
      deliberately left for whoever picks the actual hosting provider,
      since the deploy step's shape depends on that choice — nothing in
      this repo commits you to one.
- [ ] **Fill `.env` from `.env.example` per environment** — inherently a
      per-deploy manual step (secrets can't be committed), not something a
      future PR "clears" the way the two items above were — see the env var
      list under "Backend" above for what actually needs a value per
      environment versus what's optional.
