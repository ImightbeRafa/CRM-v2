/**
 * Soft Agent Layer A2 — knowledge schema readiness (separate from 027 ChatAgent).
 * Missing 028 must not disable A1 agent runtime.
 */

import 'server-only'
import { prisma } from '@/lib/db'

let cachedReady: { at: number; ready: boolean } | null = null
const CACHE_MS = 30_000

export async function isChatKnowledgeSchemaReady(force = false): Promise<boolean> {
  const now = Date.now()
  if (!force && cachedReady && now - cachedReady.at < CACHE_MS) {
    return cachedReady.ready
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT (
        to_regclass('public."ChatKnowledgeSource"') IS NOT NULL
        AND to_regclass('public."ChatAgentKnowledgeSource"') IS NOT NULL
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

export function resetChatKnowledgeSchemaReadyCache() {
  cachedReady = null
}

export async function isChatSuggestionSchemaReady(force = false): Promise<boolean> {
  // Same migration 028; tolerate missing suggestion table independently if needed later.
  try {
    const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT (
        to_regclass('public."ChatAgentSuggestion"') IS NOT NULL
        AND to_regclass('public."ChatAgentPendingAction"') IS NOT NULL
      ) AS ready
    `
    return Boolean(rows[0]?.ready)
  } catch {
    return false
  }
  void force
}
