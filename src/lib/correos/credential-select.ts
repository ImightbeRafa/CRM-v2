import { createHash } from 'node:crypto';
import type { CorreosWSCredentials } from './types';

export type CorreosCredentialSource = 'logistics_db' | 'environment';

export interface ResolvedCorreosCredentials {
  credentials: CorreosWSCredentials;
  source: CorreosCredentialSource;
}

function nonEmpty(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fromLogisticsDb(db: Record<string, string>): CorreosWSCredentials | null {
  if (!nonEmpty(db.correos_ws_username) || !nonEmpty(db.correos_ws_password)) {
    return null;
  }
  return {
    username: db.correos_ws_username.trim(),
    password: db.correos_ws_password,
    sistema: nonEmpty(db.correos_ws_sistema) ? db.correos_ws_sistema : 'PYMEXPRESS',
    usuarioId: Number(db.correos_ws_usuario_id) || 0,
    servicioId: Number(db.correos_ws_servicio_id) || 0,
    codCliente: db.correos_ws_cod_cliente || '',
  };
}

function fromEnvironment(env: NodeJS.Dict<string>): CorreosWSCredentials | null {
  if (!nonEmpty(env.CORREOS_WS_USERNAME) || !nonEmpty(env.CORREOS_WS_PASSWORD)) {
    return null;
  }
  return {
    username: env.CORREOS_WS_USERNAME.trim(),
    password: env.CORREOS_WS_PASSWORD,
    sistema: nonEmpty(env.CORREOS_WS_SISTEMA) ? env.CORREOS_WS_SISTEMA : 'PYMEXPRESS',
    usuarioId: Number(env.CORREOS_WS_USUARIO_ID) || 0,
    servicioId: Number(env.CORREOS_WS_SERVICIO_ID) || 0,
    codCliente: env.CORREOS_WS_COD_CLIENTE || '',
  };
}

/**
 * Picks one complete credential set. Logistics DB wins when username+password
 * are both present. Environment is used only when the DB set is incomplete.
 * Username from one source is never paired with a password from the other.
 */
export function selectCorreosWSCredentials(input: {
  db: Record<string, string>;
  env: NodeJS.Dict<string>;
}): ResolvedCorreosCredentials {
  const dbCredentials = fromLogisticsDb(input.db);
  if (dbCredentials) {
    return { credentials: dbCredentials, source: 'logistics_db' };
  }

  const envCredentials = fromEnvironment(input.env);
  if (envCredentials) {
    return { credentials: envCredentials, source: 'environment' };
  }

  throw new Error('Correos WS credentials are not configured.');
}

export function credentialTokenCacheKey(credentials: CorreosWSCredentials): string {
  return createHash('sha256')
    .update(`${credentials.username}\0${credentials.sistema}\0${credentials.password}`)
    .digest('hex');
}
