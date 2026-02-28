import axios from 'axios';
import http from 'http';

/**
 * Dedicated axios instance for Correos SOAP calls.
 *
 * Why this exists:
 *  - Vercel's Node.js 18+ runtime has a global `fetch` (undici).
 *  - axios v1.12+ defaults to using `fetch` as its HTTP adapter.
 *  - undici's `fetch` cannot connect to plain HTTP on non-standard port 84
 *    (the Correos SOAP endpoint), causing "fetch failed" errors.
 *  - Forcing the 'http' adapter uses Node.js's native `http.request()` which
 *    has no port restrictions.
 *
 * This instance is ONLY used by the SOAP client. The token manager uses
 * native `fetch` for HTTPS on port 442, which works fine everywhere.
 */
export const correosHttp = axios.create({
  timeout: 120_000,
  adapter: 'http',
  httpAgent: new http.Agent({ keepAlive: true }),
  headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
});
