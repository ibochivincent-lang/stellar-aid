import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Blocks the obvious SSRF footguns for a user-supplied webhook URL: non-HTTP
 * schemes, loopback/link-local/private targets, and anything that resolves
 * to them. Not exhaustive (DNS rebinding between check and request is a
 * known limitation of this class of guard generally — a production
 * deployment would re-check at connect time or route through an egress
 * proxy) but it stops the common case of a subscription pointed at
 * `http://localhost`, `http://169.254.169.254` (cloud metadata), or an
 * internal-network address.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('webhook URL must be http(s)');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('webhook URL must be https in production');
  }

  // `URL#hostname` keeps the literal `[...]` brackets for an IPv6 host
  // (e.g. `[::1]`), which `net.isIP` doesn't recognize as an address — that
  // silently sent every IPv6-literal webhook URL down the DNS-lookup branch
  // below instead of the direct-IP check, where a bracketed string never
  // resolves to anything and the guard let it straight through. Strip them
  // before every check that follows.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('webhook URL must not target localhost');
  }

  const addresses: string[] = [];
  if (isIP(hostname)) {
    addresses.push(hostname);
  } else {
    const resolved = await lookup(hostname, { all: true }).catch(() => []);
    addresses.push(...resolved.map((r) => r.address));
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      throw new Error(`webhook URL resolves to a non-routable address (${addr})`);
    }
  }
}

function isPrivateOrReservedIp(addr: string): boolean {
  if (isIP(addr) === 4) {
    const parts = addr.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // "this network"
    return false;
  }
  // IPv6: loopback, unique-local (fc00::/7), and link-local (fe80::/10).
  const lower = addr.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  return false;
}
