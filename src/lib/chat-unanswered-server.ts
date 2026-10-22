/**
 * "Sin responder" (Rafael 2026-10-22): open chats where the customer is waiting on us.
 *  - the newest message is the customer's, or
 *  - our newest message is the agent's safe line / hand-off / provider-failure reply (outcome markers of the
 *    chat's latest ChatAgentTurn: needsHuman, fallbackUsed, escalate or handoffKind) and no person wrote since.
 * The second case is also the "Necesita persona" state: such a chat must never read as handled by the IA.
 * One SQL rule (NEEDS_PERSON_SQL) feeds the list, the counts and the row flag, so they agree. Tenant-scoped.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

/**
 * True for conversation alias `c` whose latest agent turn left it to a person and no person (desk, phone app)
 * has written since. Follow-ups and AI sends are not a person.
 */
export const NEEDS_PERSON_SQL = Prisma.sql`(
  c."lastMessageDirection" = 'outbound'
  AND EXISTS (
    SELECT 1
    FROM (
      SELECT t."createdAt", t."decisionTrace" -> 'outcomeMarkers' AS om
      FROM "ChatAgentTurn" t
      WHERE t."conversationId" = c.id AND t."tenantId" = c."tenantId"
      ORDER BY t."createdAt" DESC
      LIMIT 1
    ) lt
    WHERE (
        lt.om ->> 'needsHuman' = 'true'
        OR lt.om ->> 'fallbackUsed' = 'true'
        OR lt.om ->> 'escalate' = 'true'
        OR lt.om ->> 'handoffKind' IN ('handoff', 'review')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "ChatMessage" hm
        WHERE hm."conversationId" = c.id
          AND hm."tenantId" = c."tenantId"
          AND hm.direction = 'outbound'
          AND hm."sentAt" > lt."createdAt"
          AND COALESCE(hm.metadata ->> 'softAi', '') <> 'true'
          AND hm.metadata -> 'followUp' IS NULL
      )
  )
)`

/** Customer waiting: wrote last, or the agent left it to a person (see NEEDS_PERSON_SQL). */
export const UNANSWERED_SQL = Prisma.sql`(c."lastMessageDirection" = 'inbound' OR ${NEEDS_PERSON_SQL})`

/** Which of `ids` (this tenant) are in the "Necesita persona" state. Display only: errors mean none. */
export async function needsPersonConversationIds(tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId}
        AND c.id = ANY(${ids}::text[])
        AND ${NEEDS_PERSON_SQL}`
    return new Set(rows.map((r) => r.id))
  } catch (error) {
    console.error('[chat unanswered] needs-person flag', { code: error instanceof Error ? error.name : 'error' })
    return new Set()
  }
}

/** Adds `needsPerson` to list rows (one query per page; only outbound-last rows can match). */
export async function attachNeedsPersonFlag<T extends { id: string; lastMessageDirection: string | null }>(
  tenantId: string,
  rows: T[],
): Promise<Array<T & { needsPerson?: boolean }>> {
  const candidates = rows.filter((r) => r.lastMessageDirection === 'outbound').map((r) => r.id)
  const hits = await needsPersonConversationIds(tenantId, candidates)
  return rows.map((r) => (hits.has(r.id) ? { ...r, needsPerson: true } : r))
}

/** Open chats of this tenant waiting on us, newest activity first (one view page). */
export async function listUnansweredIds(tenantId: string, closedKeys: string[], limit = 100): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId}
        AND NOT (c.status = ANY(${closedKeys}::text[]))
        AND ${UNANSWERED_SQL}
      ORDER BY c."lastMessageAt" DESC, c.id DESC
      LIMIT ${limit}`
    return rows.map((r) => r.id)
  } catch (error) {
    console.error('[chat unanswered] ids', { code: error instanceof Error ? error.name : 'error' })
    return []
  }
}
