/**
 * Cached "does this gated table exist yet" check (SQL 044 / 045 are applied by hand). Avoids running
 * failing queries on every turn (log noise) while a table is still missing. Only a real "missing
 * relation" counts as not ready; other errors are never swallowed here.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'

const READY_TTL_MS = 5 * 60_000
const MISSING_TTL_MS = 30_000
const cache = new Map<string, { at: number; ready: boolean }>()

export async function isTableReady(table: string): Promise<boolean> {
  const hit = cache.get(table)
  if (hit && Date.now() - hit.at < (hit.ready ? READY_TTL_MS : MISSING_TTL_MS)) return hit.ready
  let ready = false
  try {
    const qualified = `public."${table}"`
    const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT to_regclass(${qualified}) IS NOT NULL AS "ok"`
    ready = rows[0]?.ok === true
  } catch (error) {
    if (!isMissingRelation(error)) throw error
    ready = false
  }
  cache.set(table, { at: Date.now(), ready })
  return ready
}

export function clearTableReadyCache() {
  cache.clear()
}
