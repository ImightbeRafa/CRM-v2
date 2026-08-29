import { prisma } from '@/lib/db';
import type { CorreosWSCredentials } from './types';
import {
  selectCorreosWSCredentials,
  type ResolvedCorreosCredentials,
} from './credential-select';

const REQUIRED_ENV_VARS = [
  'CORREOS_WS_USERNAME',
  'CORREOS_WS_PASSWORD',
] as const;

async function loadLogisticsCorreosConfig(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT key, value FROM lm_carrier_configs
      WHERE key LIKE 'correos_ws_%'
    `;
    const cfg: Record<string, string> = {};
    for (const row of rows) cfg[row.key] = row.value;
    return cfg;
  } catch {
    console.error('[CorreosCredentials] Failed to read logistics Correos config');
    return {};
  }
}

/**
 * Tenant guía generation and Correos diagnostics use the same live
 * logistics credentials that already authenticate. Env vars are fallback only.
 */
export async function resolveCorreosWSCredentials(): Promise<ResolvedCorreosCredentials> {
  const db = await loadLogisticsCorreosConfig();
  return selectCorreosWSCredentials({ db, env: process.env });
}

/**
 * Reads Correos SOAP credentials from platform env vars only.
 * Prefer `resolveCorreosWSCredentials()` for tenant guía generation.
 */
export function getCorreosWSCredentials(): CorreosWSCredentials {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
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

export function isCorreosWSConfigured(): boolean {
  return REQUIRED_ENV_VARS.every((v) => !!process.env[v]);
}

export async function isCorreosWSReady(): Promise<boolean> {
  try {
    await resolveCorreosWSCredentials();
    return true;
  } catch {
    return false;
  }
}

export {
  selectCorreosWSCredentials,
  credentialTokenCacheKey,
} from './credential-select';
export type {
  CorreosCredentialSource,
  ResolvedCorreosCredentials,
} from './credential-select';
