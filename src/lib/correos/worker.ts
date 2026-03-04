const DIRECT_TOKEN_URL = 'https://servicios.correos.go.cr:447';
const DIRECT_SOAP_URL = 'https://amistadpro.correos.go.cr:444';

export function getWorkerUrl(): string {
  return process.env.CORREOS_WORKER_URL || '';
}

export function getWorkerSecret(): string {
  return process.env.CORREOS_WORKER_SECRET || '';
}

export function isWorkerConfigured(): boolean {
  return !!process.env.CORREOS_WORKER_URL && !!process.env.CORREOS_WORKER_SECRET;
}

/**
 * Resolve the token endpoint URL.
 * When the Cloudflare Worker is configured, routes through it.
 * Otherwise falls back to direct Correos connection (works locally).
 */
export function getTokenUrl(): string {
  const worker = getWorkerUrl();
  if (worker) return `${worker}/token/authenticate`;
  return `${DIRECT_TOKEN_URL}/Token/authenticate`;
}

/**
 * Resolve the SOAP endpoint URL.
 * When the Cloudflare Worker is configured, routes through it.
 * Otherwise falls back to direct Correos connection (works locally).
 */
export function getSoapEndpoint(): string {
  const worker = getWorkerUrl();
  if (worker) return `${worker}/soap/wsAppCorreos.wsAppCorreos.svc`;
  return `${DIRECT_SOAP_URL}/wsAppCorreos.wsAppCorreos.svc`;
}

/**
 * Resolve the remote WSDL URL (fallback when local bundle is missing).
 */
export function getRemoteWsdlUrl(): string {
  const worker = getWorkerUrl();
  if (worker) return `${worker}/soap/wsAppCorreos.wsAppCorreos.svc?wsdl`;
  return `${DIRECT_SOAP_URL}/wsAppCorreos.wsAppCorreos.svc?wsdl`;
}
