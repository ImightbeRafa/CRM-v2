/**
 * "Sin responder" (Rafael 2026-10-22): open chats where the customer is waiting on us.
 *  - the newest message is the customer's, or
 *  - the agent's latest real reply was a safe line / hand-off / provider failure (outcome markers of the chat's latest
 *    DELIVERED ChatAgentTurn: needsHuman, fallbackUsed, escalate or handoffKind) and no person wrote since.
 * The second case is also the "Necesita persona" state: such a chat must never read as handled by the IA.
 * "Respondido" (SQL 063, ChatConversation.answeredAt) clears both until the customer writes again / a newer hand-off.
 * One SQL rule feeds the list, the counts and the row flags, so they agree. Tenant-scoped.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { WAITING_ACK_KEY_PREFIX } from '@/lib/soft-ai/waiting-ack'
import { SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { AFTER_HOURS_REVIEW_PREFIX, promisesPerson } from '@/lib/soft-ai/business-hours'
import { softReleaseReplyOk } from '@/lib/soft-ai/soft-release'

// LIKE pattern: '_' escaped so only the literal prefix matches.
const WAITING_ACK_LIKE = `${WAITING_ACK_KEY_PREFIX.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`

/** The chat's latest real agent turn (delivered, not Probar, not the "ya le avisé" ack) as alias `lt`. */
const LATEST_REAL_TURN_SQL = Prisma.sql`(
  SELECT COALESCE(tm."sentAt", t."createdAt") AS since, t."decisionTrace" -> 'outcomeMarkers' AS om, t.intent AS intent, t."outputText" AS text
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

/** A person (desk send, phone app; not the AI, not a follow-up, not failed) wrote after `lt.since`. */
const PERSON_WROTE_SINCE_SQL = Prisma.sql`EXISTS (
  SELECT 1
  FROM "ChatMessage" hm
  WHERE hm."conversationId" = c.id
    AND hm."tenantId" = c."tenantId"
    AND hm.direction = 'outbound'
    AND hm."sentAt" > lt.since
    AND COALESCE(hm.metadata ->> 'softAi', '') <> 'true'
    AND hm.metadata -> 'followUp' IS NULL
    AND COALESCE(hm."deliveryStatus", '') <> 'failed'
)`

/**
 * True for conversation alias `c` whose latest real agent turn left it to a person and no person (desk, phone app)
 * has written since, nor marked it "Respondido".
 *  - "Respondido" covers the customer messages up to `answeredThroughAt` (the last customer message seen at the
 *    click, Meta's clock — SecureDog DATA-RSP-1): a later message / hand-off is newer and shows again.
 *  - "Since" = the customer message the turn answered (a person replying while the model was thinking counts).
 *  - A person = an outbound that is not the AI's, not a follow-up, and did not fail.
 */
export function needsPersonSql(answeredReady: boolean): Prisma.Sql {
  const notAnswered = answeredReady
    ? Prisma.sql`AND (c."answeredThroughAt" IS NULL OR c."answeredThroughAt" < lt.since)`
    : Prisma.empty
  return Prisma.sql`(
  c."lastMessageDirection" = 'outbound'
  AND EXISTS (
    SELECT 1
    FROM ${LATEST_REAL_TURN_SQL}
    WHERE ${HANDOFF_MARKERS_SQL}
      ${notAnswered}
      AND NOT ${PERSON_WROTE_SINCE_SQL}
  )
)`
}

/** Customer waiting: wrote last (after any "Respondido"), or the agent left it to a person (needsPersonSql). */
export function unansweredSql(answeredReady: boolean): Prisma.Sql {
  const inbound = answeredReady
    ? Prisma.sql`(c."lastMessageDirection" = 'inbound' AND (c."answeredThroughAt" IS NULL OR c."answeredThroughAt" < COALESCE(c."lastInboundAt", c."lastMessageAt")))`
    : Prisma.sql`c."lastMessageDirection" = 'inbound'`
  return Prisma.sql`(${inbound} OR ${needsPersonSql(answeredReady)})`
}

let answeredCache: { at: number; ready: boolean } | null = null

/** SQL 063 applied? (columns exist). Cached: 10 min once true, 60 s while missing. Errors read as missing. */
export async function answeredMarkerReady(): Promise<boolean> {
  const now = Date.now()
  if (answeredCache && now - answeredCache.at < (answeredCache.ready ? 600_000 : 60_000)) return answeredCache.ready
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ChatConversation'
        AND column_name IN ('answeredAt', 'answeredByUserId', 'answeredThroughAt')`
    answeredCache = { at: now, ready: Number(rows[0]?.n ?? 0) === 3 }
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

/**
 * When the chat's latest real agent turn handed it to a person and that hand-off is still OPEN (no person wrote
 * since): the message time it started from. Null = no open agent hand-off (Respondido then never gives the chat back
 * to the agent — SecureDog INT-RSP-1: a person who is working the chat keeps it).
 */
export async function openAgentHandoffSince(tenantId: string, conversationId: string): Promise<Date | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ since: Date | null }>>`
      SELECT (
        SELECT lt.since FROM ${LATEST_REAL_TURN_SQL}
        WHERE ${HANDOFF_MARKERS_SQL} AND NOT ${PERSON_WROTE_SINCE_SQL}
      ) AS since
      FROM "ChatConversation" c
      WHERE c."tenantId" = ${tenantId} AND c.id = ${conversationId}`
    return rows[0]?.since ?? null
  } catch {
    return null
  }
}

/**
 * Pure: Devolver a IA may close the open hand-off only when it was a missing store fact (same allowlist as the soft
 * release, SecureDog INT-RSM-1: "unknown_answer", or "escalate" with the model's own reason exactly "other"; older turns
 * with no sub-reason, safety / ownership / complaint / payment / person / night hand-offs never) AND the delivered text
 * was the agent's own answer, not a holding line.
 */
export function resumeClearsHandoff(turn: {
  text: string | null
  reason: string | null
  subReason?: string | null
  fallbackUsed: boolean
  intent: string | null
}): boolean {
  // Verifier r2 #1: "unknown_answer" always delivers a "no lo tengo / lo confirmo" text — the question is still open.
  if (!(turn.reason === 'escalate' && turn.subReason === 'other')) return false
  if (turn.fallbackUsed || turn.intent === 'outage_ack') return false
  const text = String(turn.text || '').trim()
  if (!text) return false
  const holding = [SAFE_LINE.review, SAFE_LINE.payment, SAFE_LINE.paymentSoon, SAFE_LINE.complaint].map((l) => String(l || '').trim())
  if (holding.includes(text) || text.startsWith(AFTER_HOURS_REVIEW_PREFIX)) return false
  // A reply that only stalls ("Dame un momento y te confirmo") answers nothing either.
  if (/^(?:¡?hola!?[^\n]{0,60}?)?dame\s+un\s+momento\b/iu.test(text) && text.length < 120) return false
  // Verifier r2 #1/#2: an admitted gap, a check promise, a stall or a promised person = the question is still open.
  if (!softReleaseReplyOk(text) || promisesPerson(text)) return false
  return true
}

/**
 * "Devolver a IA" (Rafael 2026-11-06): the agent had already answered and handed the chat off, so there was no
 * customer message left to answer — the chat went back to the agent but stayed in "Necesita persona" forever (that
 * state reads the latest agent turn, not aiMode). When the chat is back on an answering line and its last message is
 * ours, the open hand-off is marked handled exactly like "Respondido" (answeredThroughAt = the customer's last message,
 * never later than the hand-off it covers): the chat leaves Necesita persona and the agent answers the customer's next
 * message. A newer customer message / hand-off shows again. Tenant-scoped; returns whether it stamped. Never throws.
 * Verifier 2026-11-06 (fail closed): only a MODEL hand-off ('escalate' / 'unknown_answer') whose delivered text was the
 * agent's own answer — never a holding line ("Dame un momento…", the payment line, the after-hours line, the outage
 * line), never a payment / complaint / order hand-off, and never when the customer wrote after it (the waiting ack
 * "Ya le avisé al equipo" is ours but answers nothing): those stay in Necesita persona for a person.
 */
export async function clearOpenHandoffOnResume(input: {
  tenantId: string
  conversationId: string
  userId: string | null
}): Promise<boolean> {
  try {
    if (!(await answeredMarkerReady())) return false
    const rows = await prisma.$queryRaw<
      Array<{ since: Date | null; text: string | null; reason: string | null; sub: string | null; fallback: string | null; intent: string | null }>
    >`
      SELECT lt.since AS since, lt.text AS text, lt.om ->> 'handoffReason' AS reason, lt.om ->> 'handoffSubReason' AS sub,
             lt.om ->> 'fallbackUsed' AS fallback, lt.intent AS intent
      FROM "ChatConversation" c CROSS JOIN LATERAL ${LATEST_REAL_TURN_SQL}
      WHERE c."tenantId" = ${input.tenantId} AND c.id = ${input.conversationId}
        AND ${HANDOFF_MARKERS_SQL} AND NOT ${PERSON_WROTE_SINCE_SQL}`
    const open = rows[0]
    if (!open?.since) return false
    if (!resumeClearsHandoff({ text: open.text, reason: open.reason, subReason: open.sub, fallbackUsed: open.fallback === 'true', intent: open.intent })) return false
    const since = open.since
    const at = new Date()
    const n = await prisma.$executeRaw`
      UPDATE "ChatConversation"
      SET "answeredAt" = ${at},
          "answeredByUserId" = ${input.userId},
          "answeredThroughAt" = GREATEST(COALESCE("lastInboundAt", "lastMessageAt"), ${since}::timestamp(3)),
          "updatedAt" = ${at}
      WHERE id = ${input.conversationId}
        AND "tenantId" = ${input.tenantId}
        AND "aiMode" = 'ai_active'
        AND "lastMessageDirection" = 'outbound'
        AND COALESCE("lastInboundAt", "lastMessageAt") <= ${since}::timestamp(3)`
    return n > 0
  } catch (error) {
    console.error('[chat unanswered] resume clear', { code: error instanceof Error ? error.name : 'error' })
    return false
  }
}
