# Security Policy

StellarAID handles aid distribution — vouchers backed by locked USDC, admin
endpoints that move treasury funds on-chain, and webhook subscriptions that
receive recipient/merchant addresses and amounts. Please report security
issues privately rather than as a public GitHub issue.

## Reporting a vulnerability

Open a private security advisory on this repository (GitHub → Security →
Advisories → Report a vulnerability), or, if that isn't available, contact
the maintainers directly rather than filing a public issue or PR that
describes the vulnerability. Please include:

- A description of the issue and its impact (e.g. "an unauthenticated
  caller can burn any voucher" vs. "a malformed request 500s").
- Steps to reproduce, or a minimal PoC.
- Which component is affected: the Soroban contract (`contracts/`), the
  backend (`backend/`), or the webhook/event delivery layer specifically.

We'll acknowledge reports as soon as we can and follow up with next steps.
Please give us a reasonable window to fix an issue before any public
disclosure.

## Scope

In scope:

- `contracts/src/lib.rs` — the `aid_voucher` Soroban contract: authorization
  checks (`require_auth`), arithmetic, merchant/category/region enforcement
  in `can_redeem`, the `initialize` guard.
- `backend/src/**` — the NestJS API, especially `AdminGuard`, DTO
  validation, the webhook SSRF guard (`src/webhooks/ssrf-guard.ts`) and
  HMAC signing (`src/webhooks/verify.ts`), and anything touching the
  server's own treasury signing key.

Out of scope (already tracked as known, deliberate limitations — see
`ROADMAP.md` for the planned fix):

- `AdminGuard`'s shared-secret model — it is an interim gate, not a full
  auth system; a report saying "it's just a shared secret" is already
  known. A report showing it can be *bypassed* (e.g. the guard not applied
  to a route that needs it) is very much in scope.
- The webhook SSRF guard's DNS-rebinding window between the check and the
  actual request — documented in `ssrf-guard.ts`. A report showing a
  bypass that doesn't rely on rebinding (e.g. an address range it misses
  entirely) is in scope.

## Supported versions

This project does not yet have tagged releases; security fixes land on
`main`. Once versioned releases start, this section will list which lines
receive fixes.
