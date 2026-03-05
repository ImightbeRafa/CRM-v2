/**
 * Correos proxy configuration.
 *
 * When CORREOS_PROXY_URL is set (production on Vercel), all Correos API
 * requests are routed through the reverse proxy running on the Jetson
 * Orin Nano via Cloudflare Tunnel. The proxy forwards:
 *   /token/* → https://servicios.correos.go.cr:447/Token/*
 *   /soap/*  → https://amistadpro.correos.go.cr:444/*
 *
 * When not set (local dev in Costa Rica), requests go directly to Correos.
 */

const DIRECT_TOKEN_URL = 'https://servicios.correos.go.cr:447';
const DIRECT_SOAP_URL = 'https://amistadpro.correos.go.cr:444';

export function getProxyUrl(): string {
  return process.env.CORREOS_PROXY_URL || '';
}

export function getProxySecret(): string {
  return process.env.CORREOS_PROXY_SECRET || '';
}

export function isProxyConfigured(): boolean {
  return !!process.env.CORREOS_PROXY_URL && !!process.env.CORREOS_PROXY_SECRET;
}

export function getTokenUrl(): string {
  const proxy = getProxyUrl();
  if (proxy) return `${proxy}/token/authenticate`;
  return `${DIRECT_TOKEN_URL}/Token/authenticate`;
}

export function getSoapEndpoint(): string {
  const proxy = getProxyUrl();
  if (proxy) return `${proxy}/soap/wsAppCorreos.wsAppCorreos.svc`;
  return `${DIRECT_SOAP_URL}/wsAppCorreos.wsAppCorreos.svc`;
}

export function getRemoteWsdlUrl(): string {
  const proxy = getProxyUrl();
  if (proxy) return `${proxy}/soap/wsAppCorreos.wsAppCorreos.svc?wsdl`;
  return `${DIRECT_SOAP_URL}/wsAppCorreos.wsAppCorreos.svc?wsdl`;
}
