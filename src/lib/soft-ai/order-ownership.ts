/**
 * Who may an AI agent talk to about an order? One rule for every agent path (layer tools + v1 deps).
 *
 * An order is "owned" by the customer of a conversation when:
 *  - a human linked it to THIS conversation (Chats › Vincular pedido; ChatMessage.orderId = Order.id), or
 *  - the chat's phone (or its linked client's verified phone) matches the order's phone (last 8 digits).
 * The Prisma client from '@/lib/db' already hides soft-deleted orders (activeOrderReads extension).
 */

import { prisma } from '@/lib/db'
import { phoneOwnershipMatch } from '@/lib/soft-ai/phone-ownership'

export type OrderOwnershipContext = {
  tenantId: string
  conversationId?: string | null
  peerId: string
  peerPhoneHints?: string[]
  clientId?: string | null
  /** Probar: a hand-linked client counts without re-checking its phone. */
  sandbox?: boolean
}

export type OwnedOrderRow = {
  id: string
  orderId: string
  status: string | null
  clientId: string | null
  customerName: string | null
  phone: string | null
}

const ORDER_SELECT = {
  id: true,
  orderId: true,
  status: true,
  clientId: true,
  customerName: true,
  phone: true,
} as const

const digits = (value: string) => value.replace(/\D/g, '')

/** Orders a human linked to this conversation. The link itself is the ownership proof. */
export async function linkedOrderIds(tenantId: string, conversationId?: string | null): Promise<Set<string>> {
  if (!conversationId) return new Set()
  const rows = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId, orderId: { not: null } },
    select: { orderId: true },
    orderBy: { sentAt: 'desc' },
    take: 20,
  })
  return new Set(rows.map((r) => r.orderId).filter((id): id is string => Boolean(id)))
}

/** Phone / verified-client ownership (does not consider chat links; see isOrderOwned). */
export async function phoneOwnsOrder(
  ctx: OrderOwnershipContext,
  order: { clientId?: string | null; phone?: string | null },
): Promise<boolean> {
  const hints = [digits(ctx.peerId), ...(ctx.peerPhoneHints || []).map(digits)]
  // Last-8-digit match; short or placeholder phones ("0", "123") never match anyone (see phone-ownership.ts).
  const phoneMatches = (raw: string | null | undefined) => phoneOwnershipMatch(hints, raw ? digits(raw) : '')
  if (ctx.clientId && order.clientId && ctx.clientId === order.clientId) {
    // Chats can be linked to a client by hand (Chats › Cliente). The link alone is a human claim:
    // it proves ownership only when the linked client's phone is this chat's phone.
    if (ctx.sandbox) return true
    const client = await prisma.client.findFirst({
      where: { id: ctx.clientId, tenantId: ctx.tenantId },
      select: { phone: true, normalizedPhone: true },
    })
    if (client && (phoneMatches(client.normalizedPhone) || phoneMatches(client.phone))) return true
  }
  return phoneMatches(order.phone)
}

export async function isOrderOwned(
  ctx: OrderOwnershipContext,
  order: { id: string; clientId?: string | null; phone?: string | null },
  linked?: Set<string>,
): Promise<boolean> {
  const links = linked ?? (await linkedOrderIds(ctx.tenantId, ctx.conversationId))
  if (links.has(order.id)) return true
  return phoneOwnsOrder(ctx, order)
}

/** Best owned order for an optional order-number hint (chat-linked first, then client, then hint). */
export async function findOwnedOrder(
  ctx: OrderOwnershipContext,
  orderNumberHint?: string | null,
): Promise<OwnedOrderRow | null> {
  const hint = (orderNumberHint || '').trim()
  const needle = hint.toLowerCase()
  const linked = await linkedOrderIds(ctx.tenantId, ctx.conversationId)
  if (linked.size > 0) {
    const byLink = await prisma.order.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...linked] } },
      select: ORDER_SELECT,
      orderBy: { timestamp: 'desc' },
      take: 5,
    })
    const matched = needle
      ? byLink.find((o) => o.orderId.toLowerCase() === needle || o.orderId.toLowerCase().includes(needle))
      : byLink[0]
    if (matched) return matched
  }
  const candidates: OwnedOrderRow[] = []
  if (ctx.clientId) {
    candidates.push(
      ...(await prisma.order.findMany({
        where: { tenantId: ctx.tenantId, clientId: ctx.clientId },
        select: ORDER_SELECT,
        orderBy: { timestamp: 'desc' },
        take: 5,
      })),
    )
  }
  if (hint) {
    candidates.push(
      ...(await prisma.order.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { orderId: { equals: hint, mode: 'insensitive' } },
            { orderId: { contains: hint.replace(/^ORDER[-_]?/i, ''), mode: 'insensitive' } },
            { id: hint },
          ],
        },
        select: ORDER_SELECT,
        orderBy: { timestamp: 'desc' },
        take: 5,
      })),
    )
  }
  for (const order of candidates) {
    if (await isOrderOwned(ctx, order, linked)) return order
  }
  return null
}

/**
 * Latest usable guía for an order NUMBER. ShippingGuia.orderId stores Order.orderId (every writer does),
 * and failed attempts (no number, status failed) are skipped.
 */
export async function latestGuiaForOrderNumber(tenantId: string, orderNumber: string) {
  return prisma.shippingGuia.findFirst({
    where: {
      tenantId,
      orderId: orderNumber,
      status: { not: 'failed' },
      OR: [{ guiaNumber: { not: null } }, { trackingNumber: { not: null } }],
    },
    orderBy: { createdAt: 'desc' },
    select: { guiaNumber: true, trackingNumber: true, status: true, carrier: true, orderId: true },
  })
}
