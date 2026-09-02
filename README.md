# StellarAID — Programmable Aid Vouchers

Governments, NGOs, and foundations distribute **programmable vouchers** to citizens'
wallets. Vouchers are cryptographically locked to a recipient, spendable only at
approved merchants, for approved goods, within a region and validity window — then
auto-burn when they expire. Built on the latest 2026 Stellar protocol features.

> **Fix. Merge. Earn.** — Built for the Drips Stellar Wave Program.

---

## Why Stellar 2026

| Feature | Protocol | What it unlocks for StellarAID |
|---|---|---|
| Confidential Tokens | P25/P26 (testnet) | Voucher amounts stay **private**; donors audit via **view key** |
| ZK proofs (Noir + BN254) | P25 "X-Ray" | Eligibility proven **without leaking data** |
| Quorum Freeze | P26 "Yardstick" | Consensus-level **instant quarantine** of fraud |
| Checked 256-bit math | P26 | Overflow-safe voucher math |
| Precise TTL | P26 | Per-voucher lifetime → auto-expiry, fair rent |
| Auth delegation | P27 "Zipper" | **Smart accounts**: guardians, spending limits |
| Atomic fleet upgrades | P28 "Adapter" | Patch **every campaign contract at once** |
| Passkey embedded wallets | SEP-45 | Citizens need **no wallet app, no password** |
| x402 agent payments | Live | NGOs/agents buy aid analytics per request |

---

## Architecture

```
[Citizen App (PWA)]  [Merchant POS App]  [NGO/Donor Auditor Dashboard]
        └──────────────────┬──────────────────┘
                           ▼
        [Backend API (NestJS/TS) — JWT]
   ├── eligibility-service   (KYC + ZK verify)
   ├── voucher-service       (issue / spend / burn)
   ├── merchant-service      (whitelist + POS)
   ├── auditor-service       (view key + compliance)
   └── x402-api-service      (paid aid-analytics → agents)
                           ▼
┌────────────────────────────────────────────────────────────┐
│  SOROBAN LAYER  (all behind CAP-85 fleet executable)       │
│                                                            │
│  aid_voucher_lib.cls                                       │
│   ├─ issue_voucher       → confidential deposit            │
│   ├─ redeem              → category + geo + merchant lock  │
│   ├─ burn_expired        → TTL v2 auto-expiry              │
│   └─ freeze_voucher      → hooks Quorum Freeze             │
│                                                            │
│  confidential_vault.cls  (OpenZeppelin CT wrapper)         │
│  eligibility_zk.cls      (Noir + BN254 verifier)           │
│  citizen_account.cls     (CAP-71 smart account)            │
└────────────────────────────────────────────────────────────┘
                           ▼
        [Stellar Testnet → Mainnet (USDC settle)]
```

## Repository layout

```
stellar-aid/
├── docs/issues.md       # Wave-ready issue breakdown (100/150/200 pt)
├── contracts/           # Soroban smart contracts (Rust)
├── backend/             # NestJS + @stellar/stellar-sdk v16, incl. events/ + webhooks/
└── frontend/packages/   # Client SDKs for the (not-yet-built) citizen/merchant/auditor UI
```

## Events & webhooks

The backend polls Soroban RPC for `aid_voucher` contract events (`issued`,
`redeemed`, `burned`, `frozen`, `merchant`, `delegate`), decodes them into
typed JSON, and fans them out two ways — scoped equivalents of the
event-delivery layer in this team's other Stellar project,
[Orbital](https://github.com/determined-001/orbital_stellar), sized to what
StellarAID itself needs rather than a general-purpose registry:

- **Live stream** — `GET /api/events/stream` (Server-Sent Events). A React
  hook for it lives at `frontend/packages/use-stellar-aid-events`.
- **Signed webhooks** — `POST /api/webhooks` (admin-only) registers a URL to
  receive HMAC-SHA256-signed POSTs for voucher lifecycle events, for NGOs/
  auditors that want a push feed instead of polling. See
  `backend/src/webhooks/verify.ts` for the receiver-side signature check.

A resume cursor (`EventCursor`, per contract) means a backend restart picks
up where it left off instead of re-scanning or dropping events, within
Soroban RPC's ~7-day retention window.

## Contracts

```bash
cd contracts
# soroban-sdk 26 requires wasm32v1-none on Rust 1.84+ (rustup target add wasm32v1-none)
cargo build --target wasm32v1-none --release
cargo test                # unit tests (testutils)
stellar contract deploy --wasm target/wasm32v1-none/release/stellar_aid.wasm
```

## Backend

```bash
cd backend
npm install
cp .env.example .env      # fill in keys, network, contract id
npx prisma migrate dev
npm run start:dev
```

## Wave positioning

**Category:** Financial inclusion / real-world aid
**Core value:** Dignity-first aid distribution — nobody sees what a citizen received,
merchants can only sell approved goods, and funds that expire return to the pool.