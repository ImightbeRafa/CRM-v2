/**
 * Who may an AI agent talk to about an order? One rule for every agent path (layer tools + v1 deps).
 *
 * An order is "owned" by the customer of a conversation when:
 *  - a human linked it to THIS conversation (Chats › Vincular pedido; ChatMessage.orderId = Order.id), or
 *  - the chat's phone (or its linked client's verified phone) matches the order's phone (last 8 digits).
 * Agents of the layer also pass their business stamp (SQL 049 orderOwnership): a phone match then only counts
 * for orders of THIS agent's business (one tenant can run several businesses on several channels). An empty
 * stamp means only chat-linked orders. The v1 path / staff route pass no stamp (tenant-level, as before).
 * The Prisma client from '@/lib/db' already hides soft-deleted orders (activeOrderReads extension).
 */

import { prisma } from '@/lib/db'
import { phoneOwnershipMatch } from '@/lib/soft-ai/phone-ownership'
import { orderMatchesOwnership, type AgentOrderOwnership } from '@/lib/soft-ai/agent-settings'

export type OrderOwnershipContext = {
  tenantId: string
  conversationId?: string | null
  peerId: string
  peerPhoneHints?: string[]
  clientId?: string | null
  /** Probar: a hand-linked client counts without re-checking its phone. */
  sandbox?: boolean
  /** Channel platform. Only a WhatsApp peer id is a phone number (an Instagram id never matches a phone). */
  platform?: string | null
  /** Layer agents: the business this agent sells for. undefined = no business scoping (v1 / staff). */
  ownership?: AgentOrderOwnership
}

export type OwnedOrderRow = {
  id: string
  orderId: string
  status: string | null
  clientId: string | null
  customerName: string | null
  phone: string | null
  salesChannel: string | null
  funnel: string | null
  customFields: unknown
}

const ORDER_SELECT = {
  id: true,
  orderId: true,
  status: true,
  clientId: true,
  customerName: true,
  phone: true,
  salesChannel: true,
  funnel: true,
  customFields: true,
} as const

const digits = (value: string) => value.replace(/\D/g, '')

/**
 * Is this message's order link a HUMAN claim? Links written by an AI (legacy v1 replies stamped the order it
 * looked up, possibly from a number the customer typed) prove nothing and are never trusted.
 */
export function isTrustedOrderLink(row: { direction: string; senderUserId: string | null; metadata: unknown }): boolean {
  const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {}
  if (meta.softAi === true) return false
  // Inbound: set by Chats › Vincular pedido (a person). Outbound: only a person's own message (guía sends etc.).
  return row.direction === 'inbound' || Boolean(row.senderUserId)
}

/** Orders a PERSON linked to this conversation. The human link itself is the ownership proof. */
export async function linkedOrderIds(tenantId: string, conversationId?: string | null): Promise<Set<string>> {
  if (!conversationId) return new Set()
  const rows = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId, orderId: { not: null } },
    select: { orderId: true, direction: true, senderUserId: true, metadata: true },
    orderBy: { sentAt: 'desc' },
    take: 50,
  })
  return new Set(
    rows.filter(isTrustedOrderLink).map((r) => r.orderId).filter((id): id is string => Boolean(id)),
  )
}

/** Phone / verified-client ownership (does not consider chat links; see isOrderOwned). */
export async function phoneOwnsOrder(
  ctx: OrderOwnershipContext,
  order: { clientId?: string | null; phone?: string | null },
): Promise<boolean> {
  const peerIsPhone = !ctx.platform || ctx.platform === 'whatsapp'
  const hints = [...(peerIsPhone ? [digits(ctx.peerId)] : []), ...(ctx.peerPhoneHints || []).map(digits)]
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

export type OwnershipCheckOrder = {
  id: string
  clientId?: string | null
  phone?: string | null
  salesChannel?: string | null
  funnel?: string | null
  customFields?: unknown
}

export async function isOrderOwned(
  ctx: OrderOwnershipContext,
  order: OwnershipCheckOrder,
  linked?: Set<string>,
): Promise<boolean> {
  const links = linked ?? (await linkedOrderIds(ctx.tenantId, ctx.conversationId))
  if (links.has(order.id)) return true
  // Business scoping: a phone match only counts for orders stamped with this agent's business.
  if (ctx.ownership && !orderMatchesOwnership(ctx.ownership, order)) return false
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
