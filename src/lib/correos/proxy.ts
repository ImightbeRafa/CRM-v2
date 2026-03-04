import { HttpsProxyAgent } from 'https-proxy-agent';

let cachedAgent: HttpsProxyAgent | undefined;

/**
 * Returns an HttpsProxyAgent configured from FIXIE_URL when available.
 * On Vercel, Fixie provides an HTTP CONNECT proxy that tunnels traffic
 * to Correos' non-standard HTTPS ports (447, 444) which Vercel's
 * network otherwise blocks.
 *
 * Returns undefined when FIXIE_URL is not set (local dev), so callers
 * fall back to direct connections automatically.
 */
export function getCorreosProxyAgent(): HttpsProxyAgent | undefined {
  const proxyUrl = process.env.FIXIE_URL;
  if (!proxyUrl) return undefined;

  if (!cachedAgent) {
    cachedAgent = new HttpsProxyAgent(proxyUrl);
  }
  return cachedAgent;
}
