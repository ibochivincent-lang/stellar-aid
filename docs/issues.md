# StellarAID — Wave Issue Breakdown

Point labels follow the Drips Wave complexity model:
`trivial-100` · `medium-150` · `high-200`

## Smart contracts (`contracts/`)

| # | Issue | Type | Points | Labels |
|---|-------|------|--------|--------|
| 1 | `aid_voucher_lib`: implement `issue_voucher` / `redeem` / `burn_expired` with SAC integration and checked 256-bit math | High | 200 | `high-200`, `good-first-issue` |
| 2 | Confidential Token vault integration: deposit USDC → confidential wrapper, private transfer, withdraw, auditor view key | High | 200 | `high-200` |
| 3 | `citizen_account` smart account with CAP-71 auth delegation + spending limits + passkey auth | High | 200 | `high-200` |
| 4 | ZK eligibility verifier: Noir circuit + BN254 verification in contract | Medium | 150 | `medium-150` |
| 5 | Quorum-Freeze incident handler (freeze / unfreeze / allowlist) | Medium | 150 | `medium-150` |
| 6 | Precise TTL v2 policy per voucher + auto-burn on expiry | Medium | 150 | `medium-150` |
| 7 | Muxed strkey helpers, XDR builders, canonical test fixtures | Trivial | 100 | `trivial-100` |
| 8 | CAP-85 external-executable upgrade path for the voucher fleet | Trivial | 100 | `trivial-100` |

## Backend (`backend/`)

| # | Issue | Type | Points | Labels |
|---|-------|------|--------|--------|
| 9 | SEP-45 passkey embedded-wallet onboarding service (invite → WebAuthn → deploy wallet) | High | 200 | `high-200` |
| 10 | x402 paid aid-analytics endpoint (402 payment flow, per-request) | Medium | 150 | `medium-150` |
| 11 | Auditor view-key disclosure service (selective disclosure API) | Medium | 150 | `medium-150` |
| 12 | Wallet swapper: build → simulate → sign → submit flow against Soroban RPC | Medium | 150 | `medium-150` |
| 13 | OWASP hardening, rate limiting, idempotency keys | Trivial | 100 | `trivial-100` |

## Frontend (later Wave)

- Citizen wallet/passkey PWA (claim & redeem my vouchers)
- Merchant POS screen (scan QR → approve spend)
- Admin/auditor dashboard (programs, budgets, view-key audit)