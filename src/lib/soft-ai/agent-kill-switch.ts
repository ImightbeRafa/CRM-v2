/**
 * Platform kill switch for INBOX Soft agents. Two independent triggers, either one arms it:
 *  - env SOFT_AGENT_KILL=1 (works with the database down; needs a secret flip + deploy)
 *  - PlatformAgentPolicy row (SQL 044), toggled by a super admin in Agent Ops (instant)
 * Effect: no model call, no Meta send, no suggestion; inbound stays stored for humans. A platform-wide stop (env or global) also pauses Probar, unlock canaries and shortcut import (isPlatformAiPaused).
 * Tenant admins cannot write the table (RLS, service role only) — that is why it is not in Tenant.settings.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'

export const KILL_GLOBAL_KEY = 'agent_kill_global'
export const killTenantKey = (tenantId: string) => `agent_kill_tenant:${tenantId}`

export type KillSource = 'env' | 'platform' | 'tenant'
export type KillState = { armed: boolean; source: KillSource | null }

const CACHE_MS = 5_000
const cache = new Map<string, { at: number; armed: boolean }>()

export function envKillArmed(): boolean {
  const v = (process.env.SOFT_AGENT_KILL || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on'
}

const POLICY_TABLE = 'PlatformAgentPolicy'

async function readKey(key: string): Promise<boolean> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.armed
  let armed = false
  try {
    // Table not applied yet (SQL 044): the env switch is the only trigger; skip the failing query.
    if (!(await isTableReady(POLICY_TABLE))) {
      cache.set(key, { at: Date.now(), armed: false })
      return false
    }
    const rows = await prisma.$queryRaw<Array<{ armed: boolean | null }>>`
      SELECT ("value"->>'armed') = 'true' AS "armed"
        FROM "PlatformAgentPolicy" WHERE "key" = ${key} LIMIT 1`
    armed = rows[0]?.armed === true
  } catch (error) {
    // A transient read error must neither silently pause every reply (a skipped job is not retried) nor
    // silently DISARM an armed switch: keep the last known value (default: not armed) and log it.
    if (!isMissingRelation(error)) console.error('[agent-kill] read failed', error instanceof Error ? error.name : 'unknown')
    armed = hit?.armed === true
  }
  cache.set(key, { at: Date.now(), armed })
  return armed
}

export async function readAgentKillState(tenantId: string): Promise<KillState> {
  if (envKillArmed()) return { armed: true, source: 'env' }
  if (await readKey(KILL_GLOBAL_KEY)) return { armed: true, source: 'platform' }
  if (await readKey(killTenantKey(tenantId))) return { armed: true, source: 'tenant' }
  return { armed: false, source: null }
}

/**
 * Platform-wide pause (env switch or the global key): also stops the paid calls that are not customer turns —
 * Probar, unlock canaries and shortcut import — so a key-abuse or provider incident stops ALL spend.
 * A per-business stop does not pause that business's own tests.
 */
export async function isPlatformAiPaused(): Promise<boolean> {
  return envKillArmed() || (await readKey(KILL_GLOBAL_KEY))
}

export function clearKillCache() {
  cache.clear()
}

export class KillTableMissingError extends Error {
  constructor() {
    super('KILL_TABLE_MISSING')
    this.name = 'KillTableMissingError'
  }
}

/** Super-admin write path. Throws KillTableMissingError until SQL 044 is applied. */
export async function writeAgentKill(input: {
  key: string
  armed: boolean
  updatedBy: string
  reason: string
}): Promise<void> {
  const value = JSON.stringify({
    armed: input.armed,
    reason: input.reason.slice(0, 300),
    at: new Date().toISOString(),
  })
  try {
    await prisma.$executeRaw`
      INSERT INTO "PlatformAgentPolicy" ("key", "value", "updatedBy", "updatedAt")
      VALUES (${input.key}, ${value}::jsonb, ${input.updatedBy}, now())
      ON CONFLICT ("key") DO UPDATE
        SET "value" = EXCLUDED."value", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now()`
  } catch (error) {
    if (isMissingRelation(error)) throw new KillTableMissingError()
    throw error
  }
  cache.delete(input.key)
}

export async function listAgentKills(): Promise<
  Array<{ key: string; armed: boolean; reason: string | null; updatedAt: string }>
> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ key: string; armed: boolean | null; reason: string | null; updatedAt: Date }>
    >`SELECT "key", ("value"->>'armed') = 'true' AS "armed", "value"->>'reason' AS "reason", "updatedAt"
        FROM "PlatformAgentPolicy" ORDER BY "updatedAt" DESC LIMIT 200`
    return rows.map((r) => ({
      key: r.key,
      armed: r.armed === true,
      reason: r.reason,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }))
  } catch (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
}
