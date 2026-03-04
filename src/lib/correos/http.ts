import axios from 'axios';
import http from 'http';
import https from 'https';

/**
 * Dedicated axios instance for Correos SOAP calls.
 *
 * Why this exists:
 *  - Vercel's Node.js 18+ runtime has a global `fetch` (undici).
 *  - axios v1.12+ defaults to using `fetch` as its HTTP adapter.
 *  - Forcing the 'http' adapter uses Node.js's native http/https modules
 *    which handle non-standard ports reliably.
 *
 * Production SOAP endpoint uses HTTPS on port 444, so both agents are needed.
 * The token manager uses Node.js native `https.request()` directly
 * (see tokenManager.ts) to bypass axios entirely for the token endpoint.
 */
export const correosHttp = axios.create({
  timeout: 120_000,
  adapter: 'http',
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
});
