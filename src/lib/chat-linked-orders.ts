/**
 * Attach the most recently linked order (ChatMessage.orderId → Order.orderId) to
 * conversation list DTOs, so the list, thread header and mobile chip show "#1234"
 * even when the linking message is outside the loaded thread window.
 * One tenant-scoped query per page; failures leave the DTOs unchanged.
 */

import 'server-only'

import { prisma } from '@/lib/db'
import type { ChatConversationListItemDto } from '@/lib/chat-conversation-api'

/** Newest linked message per conversation wins (rows arrive sentAt desc). */
export function pickLatestLinkedOrders(
  rows: Array<{ conversationId: string | null; orderId: string | null; order: { orderId: string } | null }>,
): Map<string, { id: string; orderNumber: string }> {
  const byConversation = new Map<string, { id: string; orderNumber: string }>()
  for (const row of rows) {
    if (!row.conversationId || !row.orderId || !row.order?.orderId) continue
    if (!byConversation.has(row.conversationId)) {
      byConversation.set(row.conversationId, { id: row.orderId, orderNumber: row.order.orderId })
    }
  }
  return byConversation
}

export async function enrichConversationDtosWithLinkedOrders(
  tenantId: string,
  items: ChatConversationListItemDto[],
): Promise<ChatConversationListItemDto[]> {
  if (items.length === 0) return items
  try {
    const rows = await prisma.chatMessage.findMany({
      where: {
        tenantId,
        conversationId: { in: items.map((item) => item.id) },
        orderId: { not: null },
        // Nested relation filters bypass the activeOrderReads extension: exclude archived orders here.
        order: { tenantId, deletedAt: null },
      },
      orderBy: { sentAt: 'desc' },
      take: 500,
      select: { conversationId: true, orderId: true, order: { select: { orderId: true } } },
    })
    const linked = pickLatestLinkedOrders(rows)
    return items.map((item) => ({ ...item, linkedOrder: linked.get(item.id) ?? null }))
  } catch (error) {
    console.warn('[chat] linked-order enrichment skipped', error instanceof Error ? error.message : error)
    return items
  }
}
