import axios from 'axios';
import http from 'http';
import https from 'https';

/**
 * Dedicated axios instances for Correos API calls.
 *
 * Why these exist:
 *  - Vercel's Node.js 18+ runtime has a global `fetch` (undici).
 *  - axios v1.12+ defaults to using `fetch` as its HTTP adapter.
 *  - undici's `fetch` rejects connections to non-standard ports (both
 *    port 84 for SOAP and port 442 for the token REST endpoint).
 *  - Forcing the 'http' adapter uses Node.js's native http/https modules
 *    which have no port restrictions.
 */

/** Used by the SOAP client for XML calls on port 84. */
export const correosHttp = axios.create({
  timeout: 120_000,
  adapter: 'http',
  httpAgent: new http.Agent({ keepAlive: true }),
  headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
});

/** Used by the token manager for JSON calls on port 442 (HTTPS). */
export const correosTokenHttp = axios.create({
  timeout: 60_000,
  adapter: 'http',
  httpsAgent: new https.Agent({ keepAlive: true }),
  headers: { 'Content-Type': 'application/json' },
});
