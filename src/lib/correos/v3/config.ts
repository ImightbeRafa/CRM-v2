import 'server-only';
import type { CorreosV3Config, CorreosV3Environment } from './types';

/**
 * Correos v3 platform credentials. Same rule as the SOAP set
 * (credential-select.ts): one complete source wins, never mixed.
 *
 * - logistics DB (`lm_carrier_configs`, keys `correos_v3_*`, password stored
 *   encrypted with src/lib/encryption.ts)
 * - environment: CORREOS_V3_TEST_* when the environment is "test",
 *   CORREOS_V3_* when it is "prod".
 *
 * The kill switch `correos_v3_enabled` (DB) / CORREOS_V3_ENABLED (env) must be
 * "1" before any store can use v3, AND the host must allow it with CORREOS_V3_ALLOWED=1
 * (the DB is shared with the Railway preview: switching v3 on there must not reach a host
 * that was not deployed for it — SecureDog INFRA-29).
 * Writes (guías, pickups) also need the store in `correos_v3_tenants` ("*" = every store
 * that chose v3) — a store cannot opt itself into the platform account (INT-238).
 */

export const V3_DB_KEYS = {
  enabled: 'correos_v3_enabled',
  environment: 'correos_v3_env',
  username: 'correos_v3_username',
  password: 'correos_v3_password',
  codCliente: 'correos_v3_cod_cliente',
  servicioId: 'correos_v3_servicio_id',
  usuarioId: 'correos_v3_usuario_id',
  pickupCedula: 'correos_v3_pickup_cedula',
  pickupEmail: 'correos_v3_pickup_email',
  tenants: 'correos_v3_tenants',
} as const;

export type V3Source = 'logistics_db' | 'environment';

export interface ResolvedV3Config {
  config: CorreosV3Config;
  source: V3Source;
  enabled: boolean;
  /** Stores allowed to write through v3: '*' or a list of tenant ids. */
  writeTenants: '*' | string[];
}

export function parseWriteTenants(raw: string | null | undefined): '*' | string[] {
  const s = String(raw ?? '').trim();
  if (s === '*') return '*';
  return s.split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{6,64}$/.test(x)).slice(0, 500);
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function parseV3Environment(v: string | null | undefined): CorreosV3Environment {
  return String(v ?? '').trim().toLowerCase() === 'prod' ? 'prod' : 'test';
}

function build(
  environment: CorreosV3Environment,
  username: string | undefined,
  password: string | undefined,
  codCliente: string | undefined,
  servicioId: string | undefined,
  usuarioId: string | undefined,
): CorreosV3Config | null {
  const cod = Number(codCliente);
  const svc = Number(servicioId);
  if (!nonEmpty(username) || !nonEmpty(password) || !Number.isInteger(cod) || cod <= 0 || !Number.isInteger(svc) || svc <= 0) {
    return null;
  }
  return {
    environment,
    username: username.trim(),
    password,
    codCliente: cod,
    servicioId: svc,
    ...(nonEmpty(usuarioId) ? { usuarioId: usuarioId.trim() } : {}),
  };
}

export function selectV3Config(input: {
  db: Record<string, string>;
  env: NodeJS.Dict<string>;
  decrypt?: (v: string) => string;
}): ResolvedV3Config | null {
  const { db, env } = input;
  const dec = input.decrypt ?? ((v: string) => v);
  const enabled = (db[V3_DB_KEYS.enabled] === '1' || env.CORREOS_V3_ENABLED === '1') && env.CORREOS_V3_ALLOWED === '1';
  const writeTenants = parseWriteTenants(db[V3_DB_KEYS.tenants] ?? env.CORREOS_V3_TENANTS);

  const dbEnv = parseV3Environment(db[V3_DB_KEYS.environment]);
  let dbPassword: string | undefined;
  try {
    dbPassword = db[V3_DB_KEYS.password] ? dec(db[V3_DB_KEYS.password]) : undefined;
  } catch {
    dbPassword = undefined;
  }
  const fromDb = build(
    dbEnv,
    db[V3_DB_KEYS.username],
    dbPassword,
    db[V3_DB_KEYS.codCliente],
    db[V3_DB_KEYS.servicioId],
    db[V3_DB_KEYS.usuarioId],
  );
  if (fromDb) return { config: fromDb, source: 'logistics_db', enabled, writeTenants };

  const envEnv = parseV3Environment(env.CORREOS_V3_ENV);
  const p = envEnv === 'test' ? 'CORREOS_V3_TEST_' : 'CORREOS_V3_';
  const fromEnv = build(
    envEnv,
    env[`${p}USER`],
    env[`${p}PASSWORD`],
    env[`${p}COD_CLIENTE`],
    env[`${p}SERVICIO`],
    env[`${p}USUARIO_ID`],
  );
  if (fromEnv) return { config: fromEnv, source: 'environment', enabled, writeTenants };
  return null;
}

/** Loads the v3 config from the logistics DB + env (server only). */
export async function resolveV3Config(): Promise<ResolvedV3Config | null> {
  const [{ prisma }, { decrypt }] = await Promise.all([import('@/lib/db'), import('@/lib/encryption')]);
  let db: Record<string, string> = {};
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT key, value FROM lm_carrier_configs WHERE key LIKE 'correos_v3_%'
    `;
    db = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    console.error('[CorreosV3] Failed to read logistics config');
  }
  return selectV3Config({ db, env: process.env, decrypt });
}
