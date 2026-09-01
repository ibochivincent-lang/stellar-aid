import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'x-stellaraid-signature';

/** `sha256=<hex hmac>` — same shape as GitHub/Stripe-style webhook signing. */
export function signWebhookPayload(payload: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Verifies a webhook delivery on the receiving end. Use this in whatever
 * NGO/auditor service subscribes to stellar-aid's webhooks — mirrors
 * Orbital's `verifyWebhook` helper, scoped to this project's signing scheme.
 *
 * Constant-time comparison so a timing side-channel can't leak the secret.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = signWebhookPayload(rawBody, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
