import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Returns a fresh HttpsProxyAgent configured from FIXIE_URL when available.
 * On Vercel, Fixie provides an HTTP CONNECT proxy that tunnels traffic
 * to Correos' non-standard HTTPS ports (447, 444) which Vercel's
 * network otherwise blocks.
 *
 * Returns undefined when FIXIE_URL is not set (local dev), so callers
 * fall back to direct connections automatically.
 *
 * A new agent is created each call to avoid stale connections in
 * serverless environments where module-level singletons can persist
 * across cold/warm starts with dead sockets.
 */
export function getCorreosProxyAgent(): HttpsProxyAgent | undefined {
  const proxyUrl = process.env.FIXIE_URL;
  if (!proxyUrl) return undefined;
  return new HttpsProxyAgent(proxyUrl);
}

/**
 * Returns a redacted version of FIXIE_URL for logging (hides credentials).
 */
export function getProxyDescription(): string {
  const proxyUrl = process.env.FIXIE_URL;
  if (!proxyUrl) return 'none';
  try {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.username ? '***@' : ''}${u.hostname}:${u.port}`;
  } catch {
    return 'invalid URL';
  }
}
