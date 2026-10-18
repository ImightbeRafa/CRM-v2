/**
 * Server side of the /chats quick views (chat-inbox-views.ts): one grouped count query per tenant, the
 * "last message is our follow-up" flag for list rows, and the list filter for a view. Tenant-scoped everywhere.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isClosedCategory, ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG, type StageDef } from '@/lib/crm-stages'
import { PERSON_AI_MODES, type InboxCountedView, type InboxViewCounts } from '@/lib/chat-inbox-views'
import { aiOnLineIds } from '@/lib/soft-ai/agent-inbox-enrich'

/** Stage keys that close a chat (won / lost; 'hecho' unless the tenant redefined it). */
export function closedStageKeys(stages: StageDef[]): string[] {
  const keys = new Set(stages.filter((s) => isClosedCategory(s.category)).map((s) => s.key))
  if (!stages.some((s) => s.key === 'hecho')) keys.add('hecho')
  return [...keys]
}

/** Ids (of `ids`, this tenant) whose newest message is our outbound follow-up / reactivation send. */
export async function followUpLastIds(tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "ChatConversation" c
      JOIN "ChatMessage" m ON m.id = c."lastMessageId" AND m."tenantId" = c."tenantId" AND m.direction = 'outbound'
      WHERE c."tenantId" = ${tenantId}
        AND c.id = ANY(${ids}::text[])
        AND c."lastMessageDirection" = 'outbound'
        AND m.metadata -> 'followUp' IS NOT NULL`
    return new Set(rows.map((r) => r.id))
  } catch (error) {
    console.error('[chat views] follow-up flag', { code: error instanceof Error ? error.name : 'error' })
    return new Set()
  }
}

/** Adds `lastIsFollowUp` to list rows (one query per page). */
export async function attachFollowUpFlag<T extends { id: string; lastMessageDirection: string | null }>(
  tenantId: string,
  rows: T[],
): Promise<Array<T & { lastIsFollowUp?: boolean }>> {
  const candidates = rows.filter((r) => r.lastMessageDirection === 'outbound').map((r) => r.id)
  const hits = await followUpLastIds(tenantId, candidates)
  return rows.map((r) => (hits.has(r.id) ? { ...r, lastIsFollowUp: true } : r))
}

/** Open chats of the tenant whose newest message is our follow-up (cap: one list page of a view). */
export async function listFollowUpOnlyIds(tenantId: string, closedKeys: string[], limit = 100): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id
      FROM "ChatConversation" c
      JOIN "ChatMessage" m ON m.id = c."lastMessageId" AND m."tenantId" = c."tenantId" AND m.direction = 'outbound'
      WHERE c."tenantId" = ${tenantId}
        AND c."lastMessageDirection" = 'outbound'
        AND m.metadata -> 'followUp' IS NOT NULL
        AND NOT (c.status = ANY(${closedKeys}::text[]))
      ORDER BY c."lastMessageAt" DESC, c.id DESC
      LIMIT ${limit}`
    return rows.map((r) => r.id)
  } catch (error) {
    // Degrade to an empty tab; never surface database text to the client.
    console.error('[chat views] follow-up ids', { code: error instanceof Error ? error.name : 'error' })
    return []
  }
}

/** The list `where` part of a view (seguimientos is resolved to ids by the caller). */
export function viewWhere(
  view: InboxCountedView,
  closedKeys: string[],
  aiLineIds: string[],
): Prisma.ChatConversationWhereInput {
  const open: Prisma.ChatConversationWhereInput = { status: { notIn: closedKeys } }
  const notPerson: Prisma.ChatConversationWhereInput = {
    OR: [{ aiMode: null }, { aiMode: { notIn: [...PERSON_AI_MODES] } }],
  }
  switch (view) {
    case 'persona':
      return { AND: [open, { aiMode: { in: [...PERSON_AI_MODES] } }] }
    case 'pago':
      return { AND: [open, { tags: { has: PAYMENT_REVIEW_TAG } }] }
    case 'pedido':
      return { AND: [open, { tags: { has: ORDER_REVIEW_TAG } }] }
    case 'ia':
      return {
        AND: [
          open,
          notPerson,
          { socialAccountId: { in: aiLineIds } },
          { NOT: { tags: { hasSome: [PAYMENT_REVIEW_TAG, ORDER_REVIEW_TAG] } } },
        ],
      }
    case 'seguimientos':
      return open
  }
}

/**
 * Counts are kept 15 s per business and process, and concurrent callers share one in-flight query: every open /chats
 * tab (or a looping client) costs at most one scan per tenant per window.
 */
const countsCache = new Map<string, { at: number; value: Promise<Record<string, InboxViewCounts>> }>()
const COUNTS_TTL_MS = 15_000

export function loadInboxViewCounts(tenantId: string, stages: StageDef[]): Promise<Record<string, InboxViewCounts>> {
  const hit = countsCache.get(tenantId)
  if (hit && Date.now() - hit.at < COUNTS_TTL_MS) return hit.value
  const value = queryInboxViewCounts(tenantId, stages)
  if (countsCache.size > 2_000) countsCache.clear()
  countsCache.set(tenantId, { at: Date.now(), value })
  // A failed query is not cached.
  value.catch(() => {
    if (countsCache.get(tenantId)?.value === value) countsCache.delete(tenantId)
  })
  return value
}

/** Per-line counts of every view: ONE grouped query over the tenant's open chats. */
async function queryInboxViewCounts(
  tenantId: string,
  stages: StageDef[],
): Promise<Record<string, InboxViewCounts>> {
  const closedKeys = closedStageKeys(stages)
  const accounts = await prisma.socialAccount.findMany({ where: { tenantId }, select: { id: true } })
  const aiLines = await aiOnLineIds(tenantId, accounts.map((a) => a.id))
  const person = [...PERSON_AI_MODES]
  const rows = await prisma.$queryRaw<
    Array<{ socialAccountId: string; persona: bigint; pago: bigint; pedido: bigint; ia: bigint; seguimientos: bigint }>
  >`
    SELECT c."socialAccountId",
      COUNT(*) FILTER (WHERE c."aiMode" = ANY(${person}::text[])) AS persona,
      COUNT(*) FILTER (WHERE ${PAYMENT_REVIEW_TAG} = ANY(c.tags)) AS pago,
      COUNT(*) FILTER (WHERE ${ORDER_REVIEW_TAG} = ANY(c.tags)) AS pedido,
      COUNT(*) FILTER (
        WHERE c."socialAccountId" = ANY(${aiLines}::text[])
          AND (c."aiMode" IS NULL OR NOT (c."aiMode" = ANY(${person}::text[])))
          AND NOT (c.tags && ARRAY[${PAYMENT_REVIEW_TAG}, ${ORDER_REVIEW_TAG}]::text[])
      ) AS ia,
      COUNT(*) FILTER (
        WHERE c."lastMessageDirection" = 'outbound' AND m.metadata -> 'followUp' IS NOT NULL
      ) AS seguimientos
    FROM "ChatConversation" c
    LEFT JOIN "ChatMessage" m
      ON c."lastMessageDirection" = 'outbound' AND m.id = c."lastMessageId" AND m."tenantId" = c."tenantId"
        AND m.direction = 'outbound'
    WHERE c."tenantId" = ${tenantId}
      AND NOT (c.status = ANY(${closedKeys}::text[]))
    GROUP BY c."socialAccountId"`
  const out: Record<string, InboxViewCounts> = {}
  for (const r of rows) {
    out[r.socialAccountId] = {
      persona: Number(r.persona),
      pago: Number(r.pago),
      pedido: Number(r.pedido),
      ia: Number(r.ia),
      seguimientos: Number(r.seguimientos),
    }
  }
  return out
}
