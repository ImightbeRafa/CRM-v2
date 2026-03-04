import axios from 'axios';
import { getWorkerSecret } from './worker';

/**
 * Dedicated axios instance for Correos SOAP calls.
 *
 * When CORREOS_WORKER_URL is set (Vercel production), requests go through
 * the Cloudflare Worker reverse proxy on standard HTTPS port 443.
 * No special adapters or proxy agents needed.
 *
 * The X-Correos-Secret header is added so the Worker can authenticate
 * requests. It's harmless when connecting directly (local dev).
 */
const secret = getWorkerSecret();

export const correosHttp = axios.create({
  timeout: 120_000,
  headers: {
    'Content-Type': 'text/xml;charset=UTF-8',
    ...(secret ? { 'X-Correos-Secret': secret } : {}),
  },
});
