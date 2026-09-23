/**
 * Resume-safe aggregate repair for `scripts/chat-inbox-backfill.ts`.
 *
 * An interrupted apply can link messages (set conversationId) and then die
 * before `recomputeAggregates`. The next fetchBatch only sees conversationId
 * NULL, so `touched` stays empty. This helper finds conversations whose stored
 * counts do not match non-duplicate linked messages and recomputes them even
 * when the current run linked nothing.
 *
 * No Prisma / DB imports — safe for offline node:test via an injectable store.
 */

export interface ConversationCountSnapshot {
  id: string
  tenantId: string
  messageCount: number
  inboundCount: number
}

export interface LinkedMessageCountRow {
  conversationId: string
  tenantId: string
  direction: string
  duplicateOfMessageId: string | null
}

export interface ConversationActualCounts {
  conversationId: string
  messageCount: number
  inboundCount: number
}

export interface ConversationCountMismatch {
  conversationId: string
  tenantId: string
  storedMessageCount: number
  storedInboundCount: number
  actualMessageCount: number
  actualInboundCount: number
}

export interface BackfillRepairStore {
  listConversations(tenantId: string | null): Promise<ConversationCountSnapshot[]>
  listActualCounts(tenantId: string | null): Promise<ConversationActualCounts[]>
  recomputeAggregates(conversationIds: string[]): Promise<string[]>
}

export interface AggregateRepairReport {
  touched: number
  mismatchCandidates: number
  repairIds: string[]
  repaired: string[]
}

export function isWritableConversationId(id: string): boolean {
  return Boolean(id) && !id.startsWith('dry_')
}

export function countActiveLinkedMessages(
  messages: LinkedMessageCountRow[],
): ConversationActualCounts[] {
  const counts = new Map<string, { messageCount: number; inboundCount: number }>()
  for (const message of messages) {
    if (!message.conversationId || message.duplicateOfMessageId) continue
    const current = counts.get(message.conversationId) ?? { messageCount: 0, inboundCount: 0 }
    current.messageCount += 1
    if (message.direction === 'inbound') current.inboundCount += 1
    counts.set(message.conversationId, current)
  }
  return [...counts.entries()].map(([conversationId, value]) => ({
    conversationId,
    messageCount: value.messageCount,
    inboundCount: value.inboundCount,
  }))
}

export function findAggregateCountMismatches(
  conversations: ConversationCountSnapshot[],
  actualCounts: ConversationActualCounts[],
): ConversationCountMismatch[] {
  const actual = new Map(
    actualCounts.map((row) => [row.conversationId, row] as const),
  )
  const mismatches: ConversationCountMismatch[] = []
  for (const conversation of conversations) {
    const counts = actual.get(conversation.id) ?? { messageCount: 0, inboundCount: 0 }
    if (
      counts.messageCount !== conversation.messageCount ||
      counts.inboundCount !== conversation.inboundCount
    ) {
      mismatches.push({
        conversationId: conversation.id,
        tenantId: conversation.tenantId,
        storedMessageCount: conversation.messageCount,
        storedInboundCount: conversation.inboundCount,
        actualMessageCount: counts.messageCount,
        actualInboundCount: counts.inboundCount,
      })
    }
  }
  return mismatches
}

export function planAggregateRepairIds(
  touchedIds: Iterable<string>,
  mismatches: Array<{ conversationId: string }>,
): string[] {
  const ids = new Set<string>()
  for (const id of touchedIds) {
    if (isWritableConversationId(id)) ids.add(id)
  }
  for (const row of mismatches) {
    if (isWritableConversationId(row.conversationId)) ids.add(row.conversationId)
  }
  return [...ids]
}

export async function repairConversationAggregates(
  store: BackfillRepairStore,
  options: { tenantId: string | null; touchedIds: Iterable<string> },
): Promise<AggregateRepairReport> {
  const conversations = await store.listConversations(options.tenantId)
  const actualCounts = await store.listActualCounts(options.tenantId)
  const mismatches = findAggregateCountMismatches(conversations, actualCounts)
  const repairIds = planAggregateRepairIds(options.touchedIds, mismatches)
  const repaired = repairIds.length > 0 ? await store.recomputeAggregates(repairIds) : []
  const touched = [...new Set(options.touchedIds)].filter(isWritableConversationId)
  return {
    touched: touched.length,
    mismatchCandidates: mismatches.length,
    repairIds,
    repaired,
  }
}
