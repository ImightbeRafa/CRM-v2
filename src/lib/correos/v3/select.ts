import 'server-only';
import { resolveV3Config, type ResolvedV3Config } from './config';
import { CorreosV3Service } from './service';
import type { CorreosV3ClientOptions } from './client';

/**
 * Which Correos API a call uses.
 *
 * - Writes (guías, pickups): v3 only when the platform switch is on, the v3
 *   credentials are complete AND the store chose v3
 *   (ShippingConfig.settings.correos_api === 'v3'). Otherwise SOAP, as today.
 * - Reads (tracking, quotes, geography, branches): v3 whenever the platform
 *   switch is on and credentials are complete; callers fall back to SOAP on
 *   a v3 error.
 *
 * The staff bot (src/lib/bot/**) never imports this module.
 */

export type CorreosApi = 'soap' | 'v3';

export function tenantWantsV3(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && (settings as Record<string, unknown>).correos_api === 'v3';
}

export function tenantMayWriteV3(resolved: Pick<ResolvedV3Config, 'writeTenants'> | null, tenantId: string | null | undefined): boolean {
  if (!resolved || !tenantId) return false;
  return resolved.writeTenants === '*' || resolved.writeTenants.includes(tenantId);
}

export function decideCorreosApi(input: {
  resolved: Pick<ResolvedV3Config, 'enabled' | 'writeTenants'> | null;
  purpose: 'write' | 'read';
  tenantSettings?: unknown;
  tenantId?: string | null;
}): CorreosApi {
  if (!input.resolved || !input.resolved.enabled) return 'soap';
  if (input.purpose === 'read') return 'v3';
  return tenantWantsV3(input.tenantSettings) && tenantMayWriteV3(input.resolved, input.tenantId) ? 'v3' : 'soap';
}

let cached: { at: number; value: ResolvedV3Config | null } | null = null;
const CONFIG_TTL_MS = 60_000;

export function __resetV3SelectCache() {
  cached = null;
}

async function loadConfig(): Promise<ResolvedV3Config | null> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;
  const value = await resolveV3Config();
  cached = { at: Date.now(), value };
  return value;
}

/** The v3 service for a read, or null when reads should stay on SOAP. */
export async function getCorreosV3ForRead(options?: CorreosV3ClientOptions): Promise<CorreosV3Service | null> {
  const resolved = await loadConfig();
  return decideCorreosApi({ resolved, purpose: 'read' }) === 'v3' && resolved ? new CorreosV3Service(resolved.config, options) : null;
}

/** The v3 service for a write by this store, or null for SOAP. */
export async function getCorreosV3ForWrite(tenantSettings: unknown, tenantId: string): Promise<CorreosV3Service | null> {
  const resolved = await loadConfig();
  return decideCorreosApi({ resolved, purpose: 'write', tenantSettings, tenantId }) === 'v3' && resolved
    ? new CorreosV3Service(resolved.config)
    : null;
}

/** Status for settings screens (no secrets). With a tenantId: may this store write through v3. */
export async function correosV3Status(tenantId?: string | null) {
  const resolved = await loadConfig();
  return {
    configured: !!resolved,
    enabled: !!resolved?.enabled,
    storeAllowed: !!resolved?.enabled && tenantMayWriteV3(resolved, tenantId),
    environment: resolved?.config.environment ?? null,
    source: resolved?.source ?? null,
  };
}
