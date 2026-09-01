import { assertSafeWebhookUrl } from './ssrf-guard';

describe('assertSafeWebhookUrl', () => {
  it('rejects a non-URL string', async () => {
    await expect(assertSafeWebhookUrl('not-a-url')).rejects.toThrow('invalid URL');
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeWebhookUrl('ftp://example.com/hook')).rejects.toThrow('http(s)');
  });

  it('rejects localhost by name', async () => {
    await expect(assertSafeWebhookUrl('http://localhost:3000/hook')).rejects.toThrow('localhost');
    await expect(assertSafeWebhookUrl('http://foo.localhost/hook')).rejects.toThrow('localhost');
  });

  it('rejects loopback and private IPv4 literals', async () => {
    await expect(assertSafeWebhookUrl('http://127.0.0.1/hook')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://10.0.0.5/hook')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://192.168.1.1/hook')).rejects.toThrow();
    await expect(assertSafeWebhookUrl('http://172.16.0.1/hook')).rejects.toThrow();
  });

  it('rejects the cloud metadata address', async () => {
    await expect(assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
  });

  it('rejects loopback IPv6', async () => {
    await expect(assertSafeWebhookUrl('http://[::1]/hook')).rejects.toThrow();
  });

  it('allows a routable public IPv4 literal', async () => {
    await expect(assertSafeWebhookUrl('https://93.184.216.34/hook')).resolves.toBeUndefined();
  });
});
