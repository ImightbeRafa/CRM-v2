import type { CorreosWSCredentials } from './types';

const REQUIRED_VARS = [
  'CORREOS_WS_USERNAME',
  'CORREOS_WS_PASSWORD',
] as const;

/**
 * Reads Correos de Costa Rica SOAP API credentials from platform-level
 * environment variables.  These are shared across all tenants — individual
 * tenants only configure their own sender (remitente) data.
 */
export function getCorreosWSCredentials(): CorreosWSCredentials {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Correos WS platform credentials not configured. Missing env vars: ${missing.join(', ')}`,
    );
  }

  return {
    username: process.env.CORREOS_WS_USERNAME!,
    password: process.env.CORREOS_WS_PASSWORD!,
    sistema: process.env.CORREOS_WS_SISTEMA || 'PYMEXPRESS',
    usuarioId: Number(process.env.CORREOS_WS_USUARIO_ID) || 0,
    servicioId: Number(process.env.CORREOS_WS_SERVICIO_ID) || 0,
    codCliente: process.env.CORREOS_WS_COD_CLIENTE || '',
  };
}

/**
 * Returns true when the platform-level Correos WS env vars are present.
 * Used by status endpoints so the UI can show whether shipping is available.
 */
export function isCorreosWSConfigured(): boolean {
  return REQUIRED_VARS.every((v) => !!process.env[v]);
}
