import axios from 'axios';
import http from 'http';
import https from 'https';
import { getCorreosProxyAgent } from './proxy';

/**
 * Dedicated axios instance for Correos SOAP calls.
 *
 * When FIXIE_URL is set (Vercel production), all requests are tunneled
 * through the Fixie HTTP CONNECT proxy to reach Correos' non-standard
 * HTTPS port 444. When not set (local dev), direct connections are used.
 *
 * The token manager uses Node.js native `https.request()` directly
 * (see tokenManager.ts) with the same proxy agent.
 */
const proxyAgent = getCorreosProxyAgent();

export const correosHttp = axios.create({
  timeout: 120_000,
  adapter: 'http',
  httpAgent: proxyAgent ?? new http.Agent({ keepAlive: true }),
  httpsAgent: proxyAgent ?? new https.Agent({ keepAlive: true }),
  headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
});
