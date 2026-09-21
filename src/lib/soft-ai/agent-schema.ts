/**
 * Soft Agent Layer schema readiness — column-guarded until SQL 027 is applied.
 * Never assume ChatAgent* tables exist on shared Supabase.
 */

import { prisma } from '@/lib/db'

let cachedReady: { at: number; ready: boolean } | null = null
const CACHE_MS = 30_000

export async function isChatAgentSchemaReady(force = false): Promise<boolean> {
  const now = Date.now()
  if (!force && cachedReady && now - cachedReady.at < CACHE_MS) {
    return cachedReady.ready
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT (
        to_regclass('public."ChatAgent"') IS NOT NULL
        AND to_regclass('public."ChatAgentBinding"') IS NOT NULL
        AND to_regclass('public."ChatAgentTurn"') IS NOT NULL
      ) AS ready
    `
    const ready = Boolean(rows[0]?.ready)
    cachedReady = { at: now, ready }
    return ready
  } catch {
    cachedReady = { at: now, ready: false }
    return false
  }
}

export function resetChatAgentSchemaReadyCache() {
  cachedReady = null
}

export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; meta?: { table?: string }; message?: string }
  if (e.code === 'P2021') return true
  if (typeof e.message === 'string' && /does not exist|42P01/i.test(e.message)) {
    return true
  }
  return false
}
