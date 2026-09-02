# Design: Agentic aid

Status: **design only — no code in this repo yet.** This extends Phase 2/3
(the NGO/donor auditor dashboard, x402 analytics, CAP-71 smart accounts) to
let an agent — an NGO's automated compliance tool, an auditor's own AI
assistant, eventually a citizen's own agent — act on aid data and, within
tightly bounded limits, initiate spends, rather than only a human clicking
buttons in a dashboard.

This is the item that most depends on infrastructure this repo doesn't have
yet (CAP-71 smart accounts, a real frontend, the analytics endpoint being
more than a stub), so treat everything below as a target shape to build
*toward* once those land, not a near-term implementation plan.

## Two distinct capabilities, kept separate

It matters to keep these conceptually separate, because they carry very
different risk:

1. **Read-side agents** — an NGO or auditor's agent that buys analytics
   (`/data/aid-summary`, `/data/chat` — both already x402-gated and built)
   or pulls a compliance view (budget utilization, redemption patterns,
   flagged-merchant history from `backend/src/fraud`). This is safe to build
   first and mostly *is* built: x402 already meters and gates exactly this
   kind of paid, per-query access. What's missing is real analytics content
   behind `/data/aid-summary` (still a placeholder — see ROADMAP Phase 3)
   and a compliance-specific view combining `AuditLog` + fraud-oracle events
   into one queryable shape.

2. **Write-side agents** — an agent that *initiates a spend or redemption*
   on someone's behalf. This is the genuinely new, higher-risk capability,
   and it should not be built at all until CAP-71 smart accounts exist,
   because a spend-capable agent needs a spending limit enforced by
   something other than "the backend's code says so." See below.

## Why this waits on CAP-71 smart accounts specifically

Every write path in this contract today (`issue_voucher`, `redeem`,
`burn_expired`, `set_merchant`, `flag_merchant`/`post_anomaly`) authenticates
via `caller.require_auth()` against a single keypair per role — the
treasury/admin key, a merchant's own key, or (as of this pass) a dedicated
oracle key. That model has no notion of "this address may spend up to X per
day" — it's binary: an address can call the method, or it can't.

An agent that's allowed to *initiate* a spend needs exactly that kind of
bounded authority — CAP-71's whole point is delegated auth with spending
limits, guardians, and revocability, scoped to a smart account rather than a
raw keypair. Building agent-initiated spends against today's contract would
mean either (a) giving the agent a full-authority key, which is the same
mistake `signAndSubmitAs`'s oracle/treasury key separation was written to
avoid, or (b) inventing a bespoke limits system in the backend that the
contract itself doesn't enforce — which means a backend bug or compromise
bypasses the limit entirely, exactly the failure mode `AnomalyScannerService`
was deliberately designed to be incapable of (see its module doc: "AI
proposes, admin decides"). Neither is acceptable for something that moves
aid funds. So: agentic spend waits for CAP-71, full stop.

## Proposed shape, once CAP-71 exists

```
NGO/auditor agent (LLM-driven or scripted)
   │
   ├─ read path (works today): GET/POST /data/* via x402
   │
   └─ write path (needs CAP-71):
        │  agent holds a CAP-71 sub-key for a citizen_account or an
        │  org-level smart account, with:
        │    - a per-day/per-transaction spend cap
        │    - an allow-list of contract methods it may call (e.g. only
        │      `redeem`, never `issue_voucher` or admin calls)
        │    - a guardian (the NGO's human operator) who can revoke it
        │  agent submits a transaction using its sub-key
        ▼
   contracts/src/lib.rs — CAP-71 auth check runs BEFORE the method body,
   enforced by the smart account/protocol layer, not by application code
        ▼
   on success: the same redeem/spend path a human-initiated transaction
   would take — the agent is a bounded caller, not a privileged one
```

The critical property: the spend limit lives in the smart account's own
auth policy (protocol-enforced), not in `backend/src/` application code.
This mirrors the oracle-role pattern already shipped in this pass — the
scanner (`backend/src/fraud/anomaly-scanner.service.ts`) can *propose*
`flag_merchant`/`post_anomaly`, and the contract, not the scanner, decides
those calls can't move funds. An agentic spend key should be bounded the
same way: by what the contract/protocol will accept from that key, not by
"the agent's code chose not to ask for more."

## Merchant intent parsing (receipt photo / voice → structured spend request)

This piece is more tractable independent of CAP-71, and could reasonably be
built earlier: a merchant (or citizen, on the redemption side) captures a
photo of a receipt or a voice note describing a purchase, and an AI step
turns that into a structured `{ merchantWallet, amount, category }` request
— essentially a smarter front-end for the existing `POST
/vouchers/:id/redeem` flow, not a new privilege. Concretely:

- New endpoint, something like `POST /vouchers/intent/parse` — takes an
  uploaded image or transcribed voice input, runs it through
  `createChatModel()` (already built in `backend/src/ai/ai-provider.ts`,
  reusable here) with a vision-capable model and a strict extraction prompt,
  returns a structured `{ merchantWallet?, amount?, category?, confidence }`
  — never auto-submits.
- The structured result is *always* shown back to the human (merchant or
  citizen) for confirmation before the actual `redeem` call happens — this
  is UX assistance, not agent-initiated spend, and needs no new on-chain
  authority. It genuinely can be built once `frontend/` exists, independent
  of CAP-71.
- Guardrail carried over from the citizen assistant
  (`backend/src/ai/redaction.service.ts`): never let the extraction prompt
  or its output include a voucher's remaining balance unless the confirming
  human already has legitimate access to it (they do, in this flow — it's
  their own transaction) — the redaction service's `stripFinancialFields`
  is for third-party-facing contexts (the citizen chatbot's context, cross-
  merchant analytics), not this one, and reusing it here would just hide
  information from the person confirming their own spend.

## What's missing to build this

- CAP-71 smart accounts don't exist in this repo yet at all — Phase 2's
  `citizen_account` item is the prerequisite for any write-side agent work.
- A real frontend (`frontend/` is currently just a planned events-hook
  package) to host the merchant-intent confirmation step.
- `/data/aid-summary` is still a placeholder — read-side agent analytics
  has nothing real to query yet either.
- An actual policy decision (NGO-level, not engineering) on what spend caps
  and method allow-lists are appropriate per program — this needs program
  administrators' input, not just a technical default.

## Suggested build order, when this is picked up

1. Merchant/citizen intent parsing (photo/voice → confirmed redeem) — no
   new on-chain authority, buildable once a frontend exists.
2. Real content behind `/data/aid-summary` + a compliance view — pure
   read-side, buildable independent of everything else.
3. CAP-71 smart accounts (Phase 2) — prerequisite, not agentic-aid-specific.
4. Agent-initiated spend, built against (3)'s spending-limit enforcement —
   last, and only after (1)-(3) exist and CAP-71's guardian/revocation
   model has been exercised with human-initiated transactions first.
