/**
 * Pure scoring heuristics for the anomaly scanner — kept separate from
 * `AnomalyScannerService` so they're testable without mocking the event
 * engine, Stellar client, or Prisma. Every function returns a 0-100 "how
 * suspicious is this" score plus a short reason code, or `null` when
 * nothing crosses the configured bar.
 *
 * The reason codes double as the on-chain `Symbol` passed to
 * `post_anomaly`/`flag_merchant` (see contracts/src/lib.rs), so they're
 * kept short, lowercase, and underscore-only — Soroban `Symbol`s only
 * accept `[A-Za-z0-9_]` and cap out at 32 characters.
 *
 * These are intentionally simple, explainable heuristics (timing /
 * velocity / fan-out), not a trained model — see ROADMAP.md's AI
 * fraud/anomaly oracle section for what a real ML-backed scorer would need
 * (labeled fraud data this project doesn't have yet). Swapping one in
 * later only means replacing these functions' bodies; the event
 * subscription, oracle-signing, and audit-log wiring in
 * `AnomalyScannerService` doesn't change.
 */

export interface AnomalyHit {
  score: number;
  reason: string;
}

/** Redeemed suspiciously soon after issuance — a hallmark of pre-arranged voucher-for-cash schemes. */
export function scoreRapidRedemption(
  issuedAtMs: number,
  redeemedAtMs: number,
  thresholdSeconds: number,
): AnomalyHit | null {
  const deltaSeconds = (redeemedAtMs - issuedAtMs) / 1000;
  if (deltaSeconds < 0 || deltaSeconds > thresholdSeconds) return null;
  // Ramps from score 40 at the threshold down to score 95 at ~instant.
  const fraction = 1 - deltaSeconds / thresholdSeconds;
  return { score: Math.round(40 + fraction * 55), reason: 'rapid_redemption' };
}

/** Too many redemptions at one merchant within a short window — merchant-side collusion or a compromised merchant key. */
export function scoreMerchantVelocity(recentCount: number, threshold: number): AnomalyHit | null {
  if (recentCount < threshold) return null;
  const over = recentCount - threshold;
  return { score: Math.min(95, 60 + over * 5), reason: 'merchant_velocity' };
}

/** One recipient issued an unusual number of vouchers (across programs) in a short window — sybil / voucher-farming pattern. */
export function scoreRecipientFanout(recentCount: number, threshold: number): AnomalyHit | null {
  if (recentCount < threshold) return null;
  const over = recentCount - threshold;
  return { score: Math.min(95, 55 + over * 8), reason: 'recipient_fanout' };
}
