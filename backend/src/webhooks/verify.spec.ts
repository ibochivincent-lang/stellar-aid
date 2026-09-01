import { signWebhookPayload, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from './verify';

describe('webhook signing', () => {
  it('produces a sha256=<hex> signature', () => {
    const sig = signWebhookPayload('{"hello":"world"}', 'super-secret');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('is deterministic for the same payload and secret', () => {
    const a = signWebhookPayload('payload', 'secret');
    const b = signWebhookPayload('payload', 'secret');
    expect(a).toBe(b);
  });

  it('changes when the payload changes', () => {
    const a = signWebhookPayload('payload-a', 'secret');
    const b = signWebhookPayload('payload-b', 'secret');
    expect(a).not.toBe(b);
  });

  it('changes when the secret changes', () => {
    const a = signWebhookPayload('payload', 'secret-a');
    const b = signWebhookPayload('payload', 'secret-b');
    expect(a).not.toBe(b);
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'super-secret';
  const body = '{"type":"issued","voucherId":1}';

  it('accepts a correctly signed body', () => {
    const header = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, header, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body + 'tampered', header, secret)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const header = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, header, 'wrong-secret')).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });

  it('exports the header name receivers should read', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('x-stellaraid-signature');
  });
});
