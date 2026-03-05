import axios from 'axios';
import { getProxySecret } from './proxy';

/**
 * Dedicated axios instance for Correos SOAP calls.
 *
 * When CORREOS_PROXY_URL is set (Vercel production), requests go through
 * the Jetson reverse proxy via Cloudflare Tunnel on standard HTTPS port 443.
 *
 * The X-Correos-Secret header authenticates requests to the proxy.
 * Harmless when connecting directly (local dev).
 */
const secret = getProxySecret();

export const correosHttp = axios.create({
  timeout: 120_000,
  headers: {
    'Content-Type': 'text/xml;charset=UTF-8',
    ...(secret ? { 'X-Correos-Secret': secret } : {}),
  },
});
