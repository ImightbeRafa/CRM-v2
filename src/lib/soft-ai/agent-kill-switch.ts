/**
 * Platform kill switch for INBOX Soft agents. Two independent triggers, either one arms it:
 *  - env SOFT_AGENT_KILL=1 (works with the database down; needs a secret flip + deploy)
 *  - PlatformAgentPolicy row (SQL 044), toggled by a super admin in Agent Ops (instant)
 * Effect: no model call, no Meta send, no suggestion; inbound stays stored for humans. Probar keeps working.
 * Tenant admins cannot write the table (RLS, service role only) — that is why it is not in Tenant.settings.
 */
import 'server-only'

import { prisma } from '@/lib/db'

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

function isMissingTable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /42P01|does not exist|P2021|P2010/i.test(msg)
}

async function readKey(key: string): Promise<boolean> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.armed
  let armed = false
  try {
    const rows = await prisma.$queryRaw<Array<{ armed: boolean | null }>>`
      SELECT ("value"->>'armed') = 'true' AS "armed"
        FROM "PlatformAgentPolicy" WHERE "key" = ${key} LIMIT 1`
    armed = rows[0]?.armed === true
  } catch (error) {
    // Table not applied yet (or a transient read error): the env switch is the always-on trigger.
    if (!isMissingTable(error)) console.error('[agent-kill] read failed', error instanceof Error ? error.name : 'unknown')
  }
  cache.set(key, { at: Date.now(), armed })
  return armed
}

export async function readAgentKillState(tenantId?: string | null): Promise<KillState> {
  if (envKillArmed()) return { armed: true, source: 'env' }
  if (await readKey(KILL_GLOBAL_KEY)) return { armed: true, source: 'platform' }
  if (tenantId && (await readKey(killTenantKey(tenantId)))) return { armed: true, source: 'tenant' }
  return { armed: false, source: null }
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
    if (isMissingTable(error)) throw new KillTableMissingError()
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
    if (isMissingTable(error)) return []
    throw error
  }
}
