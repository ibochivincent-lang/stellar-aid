# Design: Voice-backed recovery & duress protection

Status: **design only — no code in this repo yet.** This is a full
architecture spec for the voice stack you asked to "add", covering
enrollment/liveness, voice-gated recovery, duress/coercion protection, and
the compliance/hardening layer on top. None of it is buildable yet, and
that's not a scoping choice — it's a hard dependency chain: every layer
below sits on top of SEP-45 passkeys and Confidential Tokens (both still
unbuilt — see ROADMAP.md Phase 1/2), and the on-device pieces (speaker
enrollment, liveness, local ML inference) need a mobile/native app that
doesn't exist in this repo (`frontend/` today is a planned SSE-hook package,
nothing more). Writing this as runnable-looking backend stub code would
misrepresent how far along it is, so this document is the spec: precise
enough to build from once the prerequisites exist, honest about what can't
be simulated here.

This mirrors exactly how `docs/design/zk-ai-eligibility.md` and
`docs/design/agentic-aid.md` were handled — same reasoning, same format.

## Dependency chain — why this is gated, not just prioritized

You said it yourself: "voice doesn't work without those [P0/P1]." Concretely:

- **SEP-45 passkey / `citizen_account` smart accounts (ROADMAP Phase 2,
  unbuilt).** Voice-backed recovery's entire mechanism (§P1 below) is
  "unlock releases a new *signer* onto the account." There is no signer
  rotation without a smart account with rotatable signers in the first
  place — today every wallet interaction is a single Freighter/raw keypair.
  Recovery has nothing to rotate onto.
- **Confidential Tokens (ROADMAP Phase 1, unbuilt).** The decoy-mode idea
  in §P2 ("wallet looks functional, shows a dust balance, real funds
  already vaulted") only works if balances are already confidential by
  default — if plaintext balances are visible on Prisma/Horizon the way
  they are today, a decoy dust balance is trivially disproven by anyone who
  queries the chain directly, which defeats the entire point of a duress
  decoy.
- **A mobile/native app.** On-device voiceprint enrollment, liveness
  detection, and local inference (§0) all need to run somewhere with
  microphone access and a local ML runtime — a browser tab under TLS can
  get microphone access, but running a real speaker-verification model
  client-side (not shipping raw audio to a server) needs either WebAssembly
  ML inference or a native app. Neither exists in this repo.

So the honest build order is: Phase 1 (Confidential Tokens) → Phase 2
(SEP-45/smart accounts) → a real frontend/mobile client → *then* this. Not
because voice work is unimportant, but because every layer of it is defined
in terms of primitives that don't exist yet. Section "Suggested build
order" at the end makes this concrete.

## Threat model this stack is designed against

Naming these up front because every design decision below traces back to
one of them:

1. **Recording replay** — an attacker who has captured the user saying
   their enrollment phrase (a voicemail, a video call, a public speech)
   plays it back to authenticate as them.
2. **Synthetic voice / deepfake** — an attacker generates a voice clone
   from samples of the user speaking (increasingly cheap and increasingly
   good) and uses it live.
3. **Coercion** — the legitimate user is physically present and being
   forced (at gunpoint, under threat to family) to authorize a
   recovery/unlock. Voice biometrics alone *cannot* distinguish "this is
   genuinely their voice" from "this is genuinely their voice, coerced" —
   which is exactly why the duress-phrase mechanism (§P2) exists as a
   separate, non-optional escape hatch, not an add-on.
4. **Server-side biometric data breach** — if a voiceprint (or worse, raw
   audio) sits on a server, a breach turns "reset your password" into
   "reset your face/voice," which you cannot do. This is why raw audio and
   reconstructable voiceprints never leave the device (§0).
5. **Single-factor compromise** — anything gated on voice alone is gated on
   something that can be recorded, cloned, or coerced. Every gate in this
   design requires voice **plus** something else (§"Non-negotiable rules").

## §0 — Voice stack foundation

Everything else depends on this layer existing and being trustworthy.

### 0.1 Enrollment + on-device speaker model

- The user records their enrollment phrase(s) **on their own device**,
  inside whatever app hosts the wallet (mobile app or a WebAssembly-capable
  web client — see the "mobile/native app" gap above).
- A speaker-embedding model (e.g. an ECAPA-TDNN or similar small
  speaker-verification network, run via ONNX Runtime Web / Core ML / TFLite
  depending on platform) converts the recording into a fixed-size embedding
  vector **on-device**. The raw audio is discarded immediately after
  embedding extraction — it is never uploaded, never logged, never cached
  to disk longer than the enrollment session needs.
- The embedding itself — while not literally "the audio" — is still
  biometric data (it can, with the right model, be used to synthesize a
  voice or to match against other recordings), so it does not go to the
  server either. Instead:
  - The embedding is stored **locally**, encrypted at rest with a
    device-bound key (Secure Enclave / Android Keystore / equivalent),
    exactly the way the wallet's own signing key already needs to be
    protected.
  - What the server receives is a **signed, non-reconstructable
    fingerprint**: a one-way commitment derived from the embedding (e.g.
    `HMAC-SHA256(embedding, per-user-salt)` or, if a proper biometric
    template protection scheme is used, a "cancelable biometrics" transform
    — see `docs/design/zk-ai-eligibility.md`'s eligibility-commitment
    pattern for the same shape of "commit, don't reveal" idea). The server
    can later verify "does a freshly computed on-device fingerprint match
    the one on file" without ever holding anything that could reconstruct
    the voice.
  - This mirrors the redaction discipline already established in
    `backend/src/ai/redaction.service.ts` (never let sensitive data reach
    the server if it doesn't have to) and the eligibility design doc's
    trust boundary — same principle, applied to biometrics instead of
    financial/eligibility data.

### 0.2 Challenge-response protocol

- Authentication is never "say your enrolled phrase" alone — the server (or
  the device, if working offline against a locally cached challenge set)
  issues a random challenge: **"say 4-7-2"**, a fresh random digit string
  each time.
- The device captures the response, verifies (a) the spoken digits match
  the challenge (a small ASR pass, on-device) and (b) the voice embedding
  matches the enrolled fingerprint (§0.1) above a similarity threshold.
- This single-handedly closes the #1 practical attack (recording replay):
  a recording of the user saying "the quick brown fox" can never answer
  "say 4-7-2" issued a second later. It does not close synthetic-voice
  attacks (§0.3 covers that) — challenge-response and liveness are
  complementary, not substitutes for each other.
- Challenge expiry needs to be short (seconds, not the multi-minute TTL an
  access token gets) and single-use — replaying a *correct* answer to an
  *old* challenge must fail once that challenge has been consumed or has
  expired.

### 0.3 Liveness check

- Anti-spoofing validation layered on top of the embedding match: signal
  analysis for the acoustic artifacts of playback (frequency response of a
  speaker, compression artifacts of a re-recorded file) and, ideally,
  synthetic-speech detection (models trained specifically to catch
  TTS/voice-clone output, which — even very good ones — tend to leave
  statistical fingerprints current liveness detectors can catch).
- This is the layer that ages fastest — voice cloning quality moves fast,
  and a liveness model trained against today's best clones will need
  retraining against tomorrow's. Budget for this as an ongoing model
  maintenance cost, not a one-time build, when this is actually
  implemented.
- Liveness failing should **fail closed** into "try again" or "fall back to
  a different factor," never into "proceed with degraded confidence" —
  there's no safe partial-credit here.

## §P1 — Voice-backed recovery (the base feature)

This is the actual product feature everything in §0 exists to support:
recovering wallet access when the primary passkey is lost, without a seed
phrase the user has to safely store themselves.

### 4. Escrowed recovery shard

- The wallet's recovery material is split Shamir-secret-sharing style (k-of-n)
  across multiple holders — e.g. the user's own encrypted cloud backup, an
  StellarAID-operated escrow service, and (§P3) an optional guardian/co-op
  share.
- Releasing *this service's* share requires **all** of: a passed
  voice-verify + liveness challenge (§0), a time delay (hours, not
  instant — see below), and a secondary-channel confirmation (an
  email/SMS link, or an in-app push on a *different* already-trusted
  device). All three, not any one — see "Non-negotiable rules."
- The time delay exists specifically so that a real user who's been
  socially engineered or whose voice was cloned has a window to notice
  ("why did I get a recovery-initiated email I didn't request?") and cancel
  before the share actually releases. This is the same "friction as a
  security feature" reasoning that makes bank wire holds and password-reset
  delays effective — it trades a few hours of legitimate-user inconvenience
  for a hard stop on a large class of attacks that need speed to work.
- Recovery-initiated notifications go out on **every** attempt, successful
  or not, on the secondary channel — silent recovery attempts (from a
  legitimate user's perspective) are themselves a signal something is
  wrong.

### 5. Smart-account signer rotation

- Once the shard(s) needed to reach the k-of-n threshold are reassembled
  and the time delay has elapsed without cancellation, the wallet doesn't
  hand the user a raw seed to re-import — it triggers a **signer rotation**
  on the CAP-71 smart account (ROADMAP Phase 2): the old (lost) passkey
  signer is revoked, a new one — generated fresh on whatever device the
  user is recovering onto — is added.
- This is strictly better than "recover the seed": the old device, if it's
  merely lost rather than compromised, loses signing authority the moment
  rotation completes, instead of an attacker who later finds the old device
  still being able to sign with a seed that was never actually invalidated.
- This item is the one most directly blocked on Phase 2 — there is no
  "signer" to rotate without a smart account that supports multiple/
  rotatable signers in the first place.

### 6. Cold paper backup — kept, never sole-factor

- Voice recovery is additive, not a replacement for a written/printed
  recovery backup as the final fallback (a scenario where the user has no
  device, no voice — illness, injury, or simply an environment where none
  of the digital recovery path is available). Paper backup and voice
  recovery are two independent recovery paths a user can choose between,
  not a chain where losing voice access means losing the account.
- The paper backup must never be reconstructable *from* the voice path (or
  vice versa) — they need to be genuinely independent shares/paths, not two
  doors into the same lock, or compromising the "easier" one compromises
  both.

## §P2 — Voice for coercion protection

This is the layer that treats "the account holder is speaking, but under
duress" as a threat model distinct from "is this really their voice" — see
threat #3 above. This is the part of the spec I'd flag as needing the most
scrutiny before building, because getting it wrong has real safety
consequences for a user who is actually being coerced.

### 7. Duress phrase → 48h lockdown

- A second, separately-enrolled phrase (never the same as the recovery
  phrase — see item 11) that, when spoken instead of the normal
  verification response, triggers `emergency_lock` instead of authorizing
  anything.
- `emergency_lock` freezes the account (mirrors the contract's existing
  `freeze_voucher`/merchant-deactivation pattern — a state the account
  enters that blocks spends, not something reversible by more voice input)
  for a fixed 48-hour window. Unlocking early requires **either** a signed
  passkey action from a device that was already trusted *before* the
  lockdown began, **or** a pre-registered duress delegate (a person the
  user designated in advance, during calm enrollment, specifically for this
  scenario) acting through their own separate authorization path.
- **No early unlock via voice, ever, under any circumstance** — this is
  intentional and load-bearing, not an oversight to fix later: if voice
  alone could cancel a duress lock, a coercer could simply force the victim
  to say the "I'm fine, unlock" version too. The 48-hour floor is what
  makes the duress phrase actually protective rather than theatrical.
- Optional **decoy mode**: while locked down, the wallet UI continues to
  function and shows a small "dust" balance — real funds are already
  moved to a vault path (this is the piece that hard-depends on
  Confidential Tokens, see the dependency-chain section above) so an
  attacker who forces the victim to show them "the wallet" sees a normal-
  looking, low-value account and has no on-chain way to prove otherwise.

### 8. Voice as MFA on high-value operations

- For large voucher redemptions/spends (a threshold TBD per program), voice
  challenge-response is required **in addition to** the passkey signature
  — not instead of it. This is a straightforward "step-up auth for
  high-value actions" pattern, the same shape as requiring a second factor
  for a large bank transfer, applied to StellarAID's existing spend paths.

## §P3 — Hardening & compliance

### 9. Voice-unlock guardianship

- For family/co-op custody arrangements, recovery and duress-lockdown
  actions can additionally require a guardian's chip/share (extends the
  Shamir k-of-n scheme in §4 with a guardian as one of the n shares) —
  useful for a household where, e.g., an elderly relative's account should
  require a family member's participation to recover, not unilateral voice
  access by anyone who's cloned their voice.

### 10. ZK-attestable voice proof

- Prove "voice-authorized" (the challenge-response + liveness check
  passed) to a relying party (an auditor, a dispute-resolution process, or
  the contract itself) **without revealing the audio or the voiceprint** —
  the same "prove a property of private data without revealing the data"
  shape as `docs/design/zk-ai-eligibility.md`'s `score >= threshold`
  circuit. Concretely: the on-device verification step outputs a
  commitment plus a proof that the commitment corresponds to a passing
  challenge-response/liveness result, and that proof (not the audio, not
  the embedding) is what travels off-device.
- Same caveat as the eligibility design doc: a ZK proof here proves the
  *on-device computation* was done correctly — it does not, by itself,
  prove the device wasn't compromised or the model wasn't fed a synthetic
  sample that fooled it. The proof strengthens "this claim is verifiable
  without exposing biometric data," not "liveness detection is infallible."
- This item is explicitly last in this phase for a reason beyond difficulty
  — it should be built only after the ZK eligibility circuit (Phase 1) has
  actually been through a real toolchain/circuit-design cycle once, so the
  second ZK integration in this codebase isn't also the first.

### 11. Multiple phrases

- Recovery phrase and duress phrase must be **separately enrolled and
  acoustically/lexically distinct enough that producing one under
  observation doesn't reveal or hint at the other** — a forced user should
  not have their only escape hatch be "say the phrase that looks
  suspiciously different from the one I was just told to say." Enrollment
  UX needs to actively help users choose distinct phrases rather than
  variations of the same sentence.

### 12. Field robustness

- The speaker model and liveness detector need validation against real
  low-end mics, background noise, and the acoustic effects of illness (a
  cold, congestion) — a system that only works with a studio mic in a
  quiet room fails exactly the users this project is for. Multi-language
  support is a hard requirement, not a stretch goal, given StellarAID's
  target regions — a voice-recovery feature is actively harmful if it
  works only for one language/accent and silently degrades (more false
  rejects, or worse, more false accepts) for everyone else. This needs
  real fielded testing with representative users, not just held-out
  dataset accuracy numbers.

### 13. GDPR / biometric compliance

- Voiceprints and any biometric data are "special category" data under
  GDPR Article 9 (and equivalent regimes elsewhere) — this needs explicit,
  specific consent (not bundled into general terms of service), a stated
  retention policy, and a real delete flow that actually removes the
  on-device embedding and the server-side fingerprint/commitment, not just
  a soft-delete flag. Given §0.1 already keeps raw audio and
  reconstructable embeddings off the server, the compliance surface is
  smaller than a naive implementation would create — but the fingerprint/
  commitment itself, the enrollment metadata (when, how many phrases), and
  any liveness-detection logs still need to be in scope for
  access/deletion requests. This needs actual legal review before
  shipping to any GDPR-covered users, not just an engineering checklist.

## Non-negotiable rules — carried through every item above

These aren't a separate feature; they're constraints every item in §0–P3
was designed to satisfy, restated here so a future implementer can check
each piece against them directly:

- **Never sole factor.** Every gate above requires voice plus at least one
  of: passkey signature, time delay, secondary channel, guardian share.
  Nowhere in this spec does "voice matched" alone authorize anything.
- **Voice data on-device only; no PII in prompts or logs.** Raw audio and
  reconstructable embeddings never leave the enrolling device (§0.1). This
  extends the same discipline `backend/src/ai/redaction.service.ts` already
  applies to financial data in AI prompts — biometric data gets at least
  that level of care, arguably more, since it can't be rotated like a
  compromised password can.
- **No early duress-unlock, ever.** The 48-hour floor in §7 has no voice-
  based override, by design — see the reasoning under item 7.
- **Sequencing.** This entire stack is explicitly P2 — a differentiator to
  build *after* testnet deploy, passkey/SEP-45, and Confidential Tokens
  exist, per your own framing. Nothing here should be started before those
  land; see "Suggested build order" below for the concrete sequencing this
  implies.

## What's missing to build this (why it's design-only)

- SEP-45 passkey / CAP-71 smart accounts with rotatable signers — item 5
  has nothing to rotate onto without this (ROADMAP Phase 2, unbuilt).
- Confidential Tokens — decoy mode (item 7) is trivially defeated without
  confidential balances (ROADMAP Phase 1, unbuilt).
- A mobile or WebAssembly-capable native client — on-device enrollment,
  challenge-response ASR, and liveness detection all need local ML
  inference with microphone access; `frontend/` doesn't exist yet at all.
- A chosen speaker-verification model, liveness/anti-spoofing model, and
  their on-device runtimes (ONNX Runtime Web, Core ML, TFLite, or similar)
  — none evaluated or selected yet; this needs a dedicated model-selection
  spike once the client platform (item above) is decided.
- The Noir circuit work from `docs/design/zk-ai-eligibility.md` needs to
  ship and be validated first, per item 10's own note above.
- Legal review for the GDPR/biometric compliance layer (item 13) — not an
  engineering task.

## Suggested build order, when this is picked up

1. Ship Confidential Tokens (Phase 1) and SEP-45/CAP-71 smart accounts
   (Phase 2) — both prerequisites, neither voice-specific.
2. Stand up a real mobile or WASM-capable client — prerequisite for any
   on-device biometric work, and needed for the product regardless of
   voice.
3. §0 (enrollment, challenge-response, liveness) as a standalone
   authentication *factor* — ship and validate this on its own, gated
   behind a feature flag, before it authorizes anything account-critical.
   Field-test §12's robustness concerns here, early, against real users
   and real languages/accents/hardware — this is the item most likely to
   reveal the design needs rework, and it's cheapest to discover before
   §P1/§P2 are built on top of it.
4. §P1 (recovery) — the base product feature, once §0 has field validation.
5. §P2 (duress protection) — build and get this specifically reviewed (a
   security/safety review with someone whose job is coercion/duress
   scenarios, not just a code review) before shipping, given the real-world
   stakes of getting the 48-hour-no-early-unlock rule or the decoy mode
   wrong.
6. §P3 (guardianship, ZK voice proof, multi-phrase UX, GDPR) — hardening
   and compliance on top of a feature that's already live, not a
   prerequisite to shipping items 1-8.
