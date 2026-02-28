import axios from 'axios';
import http from 'http';

/**
 * Dedicated axios instance for Correos SOAP calls.
 *
 * Why this exists:
 *  - Vercel's Node.js 18+ runtime has a global `fetch` (undici).
 *  - axios v1.12+ defaults to using `fetch` as its HTTP adapter.
 *  - undici's `fetch` rejects connections to plain HTTP on non-standard
 *    port 84 (the Correos SOAP endpoint), causing "fetch failed" errors.
 *  - Forcing the 'http' adapter uses Node.js's native `http.request()`
 *    which has no port restrictions.
 *
 * The token manager uses Node.js native `https.request()` directly
 * (see tokenManager.ts) to bypass axios entirely for HTTPS on port 442.
 */
export const correosHttp = axios.create({
  timeout: 120_000,
  adapter: 'http',
  httpAgent: new http.Agent({ keepAlive: true }),
  headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
});
