/**
 * "Sin responder" (Rafael 2026-10-22): open chats where the customer is waiting on us.
 *  - the newest message is the customer's, or
 *  - the agent's latest real reply was a safe line / hand-off / provider failure (outcome markers of the chat's latest
 *    DELIVERED ChatAgentTurn: needsHuman, fallbackUsed, escalate or handoffKind) and no person wrote since.
 * The second case is also the "Necesita persona" state: such a chat must never read as handled by the IA.
 * One SQL rule (NEEDS_PERSON_SQL) feeds the list, the counts and the row flag, so they agree. Tenant-scoped.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { WAITING_ACK_KEY_PREFIX } from '@/lib/soft-ai/waiting-ack'

// LIKE pattern: '_' escaped so only the literal prefix matches.
const WAITING_ACK_LIKE = `${WAITING_ACK_KEY_PREFIX.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`

/**
 * True for conversation alias `c` whose latest real agent turn left it to a person and no person (desk, phone app)
 * has written since.
 *  - "Latest real turn" = delivered, not a Probar session, not the "ya le avisé al equipo" ack (same pick as the
 *    engine's waiting-ack). A skipped turn ("a person has it") or the ack never hides an open hand-off.
 *  - "Since" = the customer message the turn answered (a person replying while the model was thinking counts).
 *  - A person = an outbound that is not the AI's, not a follow-up, and did not fail.
 */
export const NEEDS_PERSON_SQL = Prisma.sql`(
  c."lastMessageDirection" = 'outbound'
  AND EXISTS (
    SELECT 1
    FROM (
      SELECT COALESCE(tm."sentAt", t."createdAt") AS since, t."decisionTrace" -> 'outcomeMarkers' AS om
      FROM "ChatAgentTurn" t
      LEFT JOIN "ChatMessage" tm ON tm.id = t."triggerMessageId" AND tm."tenantId" = t."tenantId"
      WHERE t."conversationId" = c.id
        AND t."tenantId" = c."tenantId"
        AND t.status = 'delivered'
        AND t."testSessionId" IS NULL
        AND t."automationDeliveryKey" NOT LIKE ${WAITING_ACK_LIKE}
      ORDER BY t."createdAt" DESC, t.id DESC
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
          AND hm."sentAt" > lt.since
          AND COALESCE(hm.metadata ->> 'softAi', '') <> 'true'
          AND hm.metadata -> 'followUp' IS NULL
          AND COALESCE(hm."deliveryStatus", '') <> 'failed'
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

/**
 * Open chats of this tenant waiting on us, newest activity first (one view page). `accountIds` = the line / channel
 * filter, applied HERE so a busy line never pushes another line's waiting chats out of the page.
 */
export async function listUnansweredIds(
  tenantId: string,
  closedKeys: string[],
  limit = 100,
  accountIds: string[] | null = null,
): Promise<string[]> {
  try {
    const lineFilter = accountIds ? Prisma.sql`AND c."socialAccountId" = ANY(${accountIds}::text[])` : Prisma.empty
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId}
        AND NOT (c.status = ANY(${closedKeys}::text[]))
        ${lineFilter}
        AND ${UNANSWERED_SQL}
      ORDER BY c."lastMessageAt" DESC, c.id DESC
      LIMIT ${limit}`
    return rows.map((r) => r.id)
  } catch (error) {
    console.error('[chat unanswered] ids', { code: error instanceof Error ? error.name : 'error' })
    return []
  }
}
