# Design: ZK + AI eligibility

Status: **design only — no code in this repo yet.** This is Phase 1's
`eligibility_zk.cls` item, extended with an AI-assisted screening step ahead
of the proof. Nothing here should be implemented until a Noir toolchain and
a real verifier key ceremony are actually in place — see "What's missing to
build this" at the end.

## Problem

Today, "is this person eligible for this aid program" is either not checked
at all, or checked by an admin reading raw KYC/means-testing data and
calling `set_merchant`/off-chain approval by hand. Two things are wrong with
that: the underlying data (income, household size, location, whatever the
program's criteria are) sits in the clear somewhere, and the decision has no
verifiable link back to the criteria — an auditor has to trust the admin
did it right.

The goal: a citizen (or an NGO caseworker on their behalf) supplies
eligibility inputs; an AI-assisted screening step turns those into a single
numeric eligibility score against a program's published rubric; a Noir
circuit proves `score >= threshold` **without revealing the inputs or the
score itself** on-chain; the contract verifies the proof and unlocks
`issue_voucher` for that recipient/program pair. No component in this chain
except the citizen's own device (or a caseworker's device the citizen
trusts) sees both the raw inputs and the score.

## Why AI is even in this pipeline

Eligibility criteria are rarely a single clean threshold — "household
income under X" is easy, but "chronic food insecurity in a conflict-affected
region with at least two of five risk factors present" is not something you
write as a five-line scoring function without either being too rigid (misses
real cases) or too gameable (a well-briefed applicant learns exactly which
five factors to claim). An AI-assisted pass — structured intake questions,
free-text caseworker notes, or document upload (a utility bill, a ration
card) turned into a structured, program-specific eligibility score — is the
same pattern the citizen assistant (`backend/src/ai/`) already uses for
retrieval: **the model proposes a structured signal; nothing downstream
trusts it blindly.** The circuit only proves a property of that signal
(`score >= threshold`), and the signal itself never has to be believed
on faith — see "Trust boundary" below for what keeps it honest enough to
gate real aid.

## Proposed flow

```
citizen / caseworker device
   │  raw eligibility inputs (never leave this device unencrypted)
   ▼
AI eligibility scorer (same device or a trusted enclave — NOT the
stellar-aid backend; see Trust boundary)
   │  produces: score (0-100), programId, a commitment to the inputs
   ▼
Noir circuit (client-side proving)
   │  private inputs: score, salt
   │  public inputs: programId, threshold, commitment
   │  proves: score >= threshold  AND  commitment = hash(inputs, salt)
   ▼
proof + public inputs
   ▼
POST /vouchers/issue  (extended DTO: proof, publicInputs)
   ▼
backend/src/vouchers/vouchers.service.ts
   │  calls a new contract method: verify_eligibility(proof, public_inputs)
   ▼
contracts/src/lib.rs  (BN254 pairing check via a Soroban-hosted verifier,
   same integration shape eligibility_zk.cls already names in ROADMAP)
   │  on success: proceeds into the existing issue_voucher path
   ▼
voucher issued — eligibility proven, inputs and score never touched
the backend, database, or chain in the clear
```

## Trust boundary — the honest limitation

A ZK proof only proves that *a* score satisfying the circuit's arithmetic
was produced from *some* committed inputs — it says nothing about whether
those inputs were true, or whether the AI scorer that produced the score was
honest. This is not a flaw specific to adding AI to the pipeline; it is true
of every "prove a computed value without revealing its inputs" system. Two
consequences that have to be designed for, not hand-waved past:

1. **The AI scorer must run somewhere the citizen (or a caseworker acting
   as a semi-trusted intermediary, e.g. an NGO field worker under existing
   accountability structures) controls or explicitly trusts** — not the
   stellar-aid backend, and not a third-party API call the backend makes on
   the citizen's behalf, because either of those would mean the operator of
   this system sees the raw eligibility inputs, which defeats the entire
   point of doing this with ZK in the first place. In practice this likely
   means: an on-device model (small enough to run offline, which rules out
   most frontier hosted models), or a caseworker's device running the same
   AI provider integration `backend/src/ai/ai-provider.ts` already wraps,
   with its own API key, talking to the AI vendor directly rather than
   through stellar-aid's backend.
2. **A malicious or compromised scorer can still produce a fraudulent
   high score for false inputs** — the circuit can't detect that, only that
   the arithmetic is self-consistent. The mitigation is out-of-band: the
   anomaly oracle (`backend/src/fraud/`, already built) watching for
   *outcomes* consistent with eligibility fraud (unusual approval rates
   from one caseworker device, geographic clustering, velocity), the same
   way it watches for merchant/redemption fraud today. ZK proves the
   arithmetic; the fraud oracle is what has to catch a dishonest input.

Any implementation of this feature needs to state this trust boundary
explicitly to program administrators — "eligibility is cryptographically
consistent with a score" is a materially different (weaker) claim than
"eligibility inputs were true," and conflating the two in program marketing
or NGO-facing docs would be a real problem, not just a technicality.

## Contract-side interface (sketch, not implemented)

```rust
// contracts/src/lib.rs — sketch only, not present in the current contract.

#[contracttype]
pub struct EligibilityProof {
    pub proof: BytesN<256>,        // Groth16/PLONK proof bytes, format TBD by the Noir backend chosen
    pub commitment: BytesN<32>,     // public input: hash(inputs, salt)
    pub program_id: u32,            // public input
    pub threshold: u32,             // public input — must match AidProgram's configured threshold
}

pub fn issue_voucher_with_eligibility(
    env: Env,
    caller: Address,
    recipient: Address,
    voucher_id: u32,
    amount: i128,
    category: Symbol,
    region: Symbol,
    expires_at: u64,
    eligibility: EligibilityProof,
) -> Result<(), VoucherError> {
    Self::require_admin(&env, &caller)?; // or a caseworker role, TBD
    if eligibility.program_id != /* the program this voucher belongs to */ {
        return Err(VoucherError::EligibilityMismatch);
    }
    Self::verify_eligibility_proof(&env, &eligibility)?; // BN254 pairing check
    Self::issue_voucher(env, caller, recipient, voucher_id, amount, category, region, expires_at)
}
```

Whether this becomes a new method (as sketched) or a precondition wrapped
around the existing `issue_voucher` is an open design question — a new
method keeps `issue_voucher` usable for programs that don't require ZK
eligibility (many won't) without threading an `Option<EligibilityProof>`
through every call site.

## Backend-side interface (sketch, not implemented)

- `POST /vouchers/issue` DTO gains an optional `eligibilityProof: { proof:
  string (base64), commitment: string, threshold: number }` field, required
  only for programs configured with `AidProgram.requiresEligibilityProof =
  true` (new column).
- `VouchersService.issue` passes it through to
  `issue_voucher_with_eligibility` instead of `issue_voucher` when present.
- No backend code ever computes a score or sees raw eligibility inputs —
  its only job is relaying an opaque proof to the contract, exactly the way
  `buildForClientSign` already treats a citizen wallet's signature as opaque.

## What's missing to build this (why it's design-only)

- A Noir toolchain (`nargo`) and a chosen circuit backend — not installed
  in this environment, and not currently a dependency of this repo at all.
- A trusted verifier-key ceremony (or a transparent proof system that
  doesn't need one) — this is a real operational undertaking, not a code
  change.
- A decision on where the AI scorer actually runs (see Trust boundary) —
  this is a product/deployment decision as much as a technical one, and
  blocks the circuit's input shape (the circuit needs to match whatever the
  scorer emits).
- `AidProgram`'s eligibility rubric (what the threshold means, what inputs
  feed the score) doesn't exist as a data model yet — it would need its own
  schema before either the AI scorer or the circuit can be pinned down.

## Suggested build order, when this is picked up

1. Define `AidProgram.eligibilityRubric` (structured criteria + threshold)
   as a Prisma model/JSON schema — no ZK yet, just make eligibility
   *scoring* exist and be checked in plaintext by an admin-reviewed flow.
2. Add the AI-assisted scorer as a **client-side-only** tool (a small CLI or
   the caseworker-facing frontend, once `frontend/` exists) that outputs a
   score — still no ZK, the score just travels with the voucher request in
   the clear, so this step alone already improves consistency over manual
   review.
3. Only once (1) and (2) are validated with real program rubrics, add the
   Noir circuit and contract-side verifier to make the score private too.
   Doing ZK last means the expensive, hard-to-change cryptographic layer
   gets built against a rubric and scorer that have already been used and
   iterated on, not designed blind.
