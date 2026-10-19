/**
 * Tenant-scoped chat ids for an order-number / phone / name / email search.
 * Bounded: at most 30 orders, then at most 50 chats. Never an unbounded message scan.
 */
import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { planChatSearch, type ChatSearchPlan } from '@/lib/chat-search'

const ORDER_TAKE = 30
const CONVERSATION_TAKE = 50

/** Order rows this business may match. `tenantId` is always on the root, archived orders stay out. */
export function orderMatchWhere(tenantId: string, plan: ChatSearchPlan): Prisma.OrderWhereInput | null {
  const or: Prisma.OrderWhereInput[] = []
  if (plan.orderText) or.push({ orderId: { contains: plan.orderText, mode: 'insensitive' } })
  if (plan.customerText) or.push({ customerName: { contains: plan.customerText, mode: 'insensitive' } })
  if (plan.email) or.push({ email: { equals: plan.email, mode: 'insensitive' } })
  if (plan.phoneDigits) or.push({ phone: { contains: plan.phoneDigits } })
  if (or.length === 0) return null
  return { tenantId, deletedAt: null, OR: or }
}

export async function searchConversationIds(tenantId: string, raw: string): Promise<string[]> {
  const plan = planChatSearch(raw)
  if (!plan) return []
  const where = orderMatchWhere(tenantId, plan)
  if (!where) return []
  try {
    const orders = await prisma.order.findMany({
      where,
      select: { id: true },
      take: ORDER_TAKE,
    })
    if (orders.length === 0) return []
    const links = await prisma.chatMessage.findMany({
      where: {
        tenantId,
        orderId: { in: orders.map((order) => order.id) },
        conversationId: { not: null },
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
      take: CONVERSATION_TAKE,
    })
    const ids: string[] = []
    for (const link of links) {
      if (link.conversationId) ids.push(link.conversationId)
    }
    return ids
  } catch (error) {
    console.error('[chat search] order lookup', { code: error instanceof Error ? error.name : 'error' })
    return []
  }
}
