/**
 * "Sin responder" (Rafael 2026-10-22): open chats where the customer is waiting on us.
 *  - the newest message is the customer's, or
 *  - the agent's latest real reply was a safe line / hand-off / provider failure (outcome markers of the chat's latest
 *    DELIVERED ChatAgentTurn: needsHuman, fallbackUsed, escalate or handoffKind) and no person wrote since.
 * The second case is also the "Necesita persona" state: such a chat must never read as handled by the IA.
 * "Respondido" (SQL 062, ChatConversation.answeredAt) clears both until the customer writes again / a newer hand-off.
 * One SQL rule feeds the list, the counts and the row flags, so they agree. Tenant-scoped.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { WAITING_ACK_KEY_PREFIX } from '@/lib/soft-ai/waiting-ack'

// LIKE pattern: '_' escaped so only the literal prefix matches.
const WAITING_ACK_LIKE = `${WAITING_ACK_KEY_PREFIX.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`

/** The chat's latest real agent turn (delivered, not Probar, not the "ya le avisé" ack) as alias `lt`. */
const LATEST_REAL_TURN_SQL = Prisma.sql`(
  SELECT COALESCE(tm."sentAt", t."createdAt") AS since, t."decisionTrace" -> 'outcomeMarkers' AS om, t.intent AS intent
  FROM "ChatAgentTurn" t
  LEFT JOIN "ChatMessage" tm ON tm.id = t."triggerMessageId" AND tm."tenantId" = t."tenantId"
  WHERE t."conversationId" = c.id
    AND t."tenantId" = c."tenantId"
    AND t.status = 'delivered'
    AND t."testSessionId" IS NULL
    AND t."automationDeliveryKey" NOT LIKE ${WAITING_ACK_LIKE}
  ORDER BY t."createdAt" DESC, t.id DESC
  LIMIT 1
) lt`

const HANDOFF_MARKERS_SQL = Prisma.sql`(
  -- #121 outage line ("Dame un momento" while the AI provider is down) is a hand-off in waiting, not an answer.
  lt.intent = 'outage_ack'
  OR lt.om ->> 'needsHuman' = 'true'
  OR lt.om ->> 'fallbackUsed' = 'true'
  OR lt.om ->> 'escalate' = 'true'
  OR lt.om ->> 'handoffKind' IN ('handoff', 'review')
)`

/**
 * True for conversation alias `c` whose latest real agent turn left it to a person and no person (desk, phone app)
 * has written since, nor marked it "Respondido".
 *  - "Since" = the customer message the turn answered (a person replying while the model was thinking counts).
 *  - A person = an outbound that is not the AI's, not a follow-up, and did not fail.
 */
export function needsPersonSql(answeredReady: boolean): Prisma.Sql {
  const notAnswered = answeredReady ? Prisma.sql`AND (c."answeredAt" IS NULL OR c."answeredAt" < lt.since)` : Prisma.empty
  return Prisma.sql`(
  c."lastMessageDirection" = 'outbound'
  AND EXISTS (
    SELECT 1
    FROM ${LATEST_REAL_TURN_SQL}
    WHERE ${HANDOFF_MARKERS_SQL}
      ${notAnswered}
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
}

/** Customer waiting: wrote last (after any "Respondido"), or the agent left it to a person (needsPersonSql). */
export function unansweredSql(answeredReady: boolean): Prisma.Sql {
  const inbound = answeredReady
    ? Prisma.sql`(c."lastMessageDirection" = 'inbound' AND (c."answeredAt" IS NULL OR c."answeredAt" < COALESCE(c."lastInboundAt", c."lastMessageAt")))`
    : Prisma.sql`c."lastMessageDirection" = 'inbound'`
  return Prisma.sql`(${inbound} OR ${needsPersonSql(answeredReady)})`
}

let answeredCache: { at: number; ready: boolean } | null = null

/** SQL 062 applied? (columns exist). Cached: 10 min once true, 60 s while missing. Errors read as missing. */
export async function answeredMarkerReady(): Promise<boolean> {
  const now = Date.now()
  if (answeredCache && now - answeredCache.at < (answeredCache.ready ? 600_000 : 60_000)) return answeredCache.ready
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ChatConversation'
        AND column_name IN ('answeredAt', 'answeredByUserId')`
    answeredCache = { at: now, ready: Number(rows[0]?.n ?? 0) === 2 }
  } catch {
    answeredCache = { at: now, ready: false }
  }
  return answeredCache.ready
}

/** Which of `ids` (this tenant) are waiting on us / left to a person. Display only: errors mean none. */
export async function waitingFlags(
  tenantId: string,
  ids: string[],
): Promise<Map<string, { waiting: boolean; needsPerson: boolean }>> {
  const out = new Map<string, { waiting: boolean; needsPerson: boolean }>()
  if (!ids.length) return out
  try {
    const ready = await answeredMarkerReady()
    const rows = await prisma.$queryRaw<Array<{ id: string; waiting: boolean; needs: boolean }>>`
      SELECT c.id, ${unansweredSql(ready)} AS waiting, ${needsPersonSql(ready)} AS needs
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId}
        AND c.id = ANY(${ids}::text[])`
    for (const r of rows) out.set(r.id, { waiting: Boolean(r.waiting), needsPerson: Boolean(r.needs) })
  } catch (error) {
    console.error('[chat unanswered] flags', { code: error instanceof Error ? error.name : 'error' })
  }
  return out
}

/** Adds `waiting` (Sin responder) and `needsPerson` to list rows (one query per page). */
export async function attachWaitingFlags<T extends { id: string }>(
  tenantId: string,
  rows: T[],
): Promise<Array<T & { waiting?: boolean; needsPerson?: boolean }>> {
  const flags = await waitingFlags(tenantId, rows.map((r) => r.id))
  return rows.map((r) => {
    const f = flags.get(r.id)
    if (!f) return r
    return { ...r, waiting: f.waiting, ...(f.needsPerson ? { needsPerson: true } : {}) }
  })
}

/**
 * Open chats of this tenant waiting on us — OLDEST wait first, a queue cleared top-down (Rafael 2026-10-22).
 * `accountIds` = the line / channel filter, applied HERE so a busy line never pushes another line out of the page.
 */
export async function listUnansweredIds(
  tenantId: string,
  closedKeys: string[],
  limit = 100,
  accountIds: string[] | null = null,
): Promise<string[]> {
  try {
    const ready = await answeredMarkerReady()
    const lineFilter = accountIds ? Prisma.sql`AND c."socialAccountId" = ANY(${accountIds}::text[])` : Prisma.empty
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId}
        AND NOT (c.status = ANY(${closedKeys}::text[]))
        ${lineFilter}
        AND ${unansweredSql(ready)}
      ORDER BY COALESCE(c."lastInboundAt", c."lastMessageAt") ASC, c.id ASC
      LIMIT ${limit}`
    return rows.map((r) => r.id)
  } catch (error) {
    console.error('[chat unanswered] ids', { code: error instanceof Error ? error.name : 'error' })
    return []
  }
}

/** The chat's latest real agent turn handed it to a person (Respondido then gives it back to the agent). */
export async function agentHandoffOpen(tenantId: string, conversationId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`
      SELECT 1 AS ok
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId} AND c.id = ${conversationId}
        AND EXISTS (SELECT 1 FROM ${LATEST_REAL_TURN_SQL} WHERE ${HANDOFF_MARKERS_SQL})`
    return rows.length > 0
  } catch {
    return false
  }
}
