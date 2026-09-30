import 'server-only'
import { prisma } from '@/lib/db'

/**
 * Ley 8968 (Costa Rica) access right: everything Betsy holds about ONE customer of ONE business,
 * as a single JSON document. Read only.
 *
 * Every query carries the business id explicitly (several of these models are NOT auto-scoped by
 * the tenant Prisma extension). Logistics (`lm_*`) rows are read only through order ids that came
 * from a business-scoped Order query. Label PDFs and chat media files are listed, not embedded.
 */
export const EXPORT_LIMITS = { orders: 5_000, messages: 50_000, events: 20_000 } as const

export class ExportTooLargeError extends Error {
  constructor(public readonly what: keyof typeof EXPORT_LIMITS) {
    super('EXPORT_TOO_LARGE')
  }
}

export type CustomerExport = {
  format: 'betsy-customer-export'
  version: 1
  generatedAt: string
  law: 'Ley 8968 (Costa Rica)'
  scope: { tenantId: string; clientId: string; ordersMatchedBy: 'clientId' }
  customer: unknown
  orders: unknown[]
  invoices: unknown[]
  shipping: unknown[]
  logistics: { orders: unknown[]; events: unknown[] }
  conversations: unknown[]
  messages: unknown[]
  notes: unknown[]
  tasks: unknown[]
  lifecycle: unknown
  activity: unknown[]
  counts: Record<string, number>
}

function capped<T>(rows: T[], limit: number, what: keyof typeof EXPORT_LIMITS): T[] {
  if (rows.length > limit) throw new ExportTooLargeError(what)
  return rows
}

async function lmTableExists(name: 'lm_orders' | 'lm_order_events'): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS ok`
  return rows[0]?.ok === true
}

/** Returns null when the customer is not in this business. */
export async function buildCustomerExport(tenantId: string, clientId: string): Promise<CustomerExport | null> {
  if (!tenantId || !clientId) return null
  const customer = await prisma.client.findFirst({ where: { id: clientId, tenantId } })
  if (!customer) return null

  const orders = capped(
    await prisma.order.findMany({
      where: { tenantId, clientId },
      orderBy: { timestamp: 'asc' },
      take: EXPORT_LIMITS.orders + 1,
    }),
    EXPORT_LIMITS.orders,
    'orders',
  )
  const orderIds = orders.map((o) => o.id)
  const humanOrderIds = orders.map((o) => o.orderId)

  const [invoices, shipping, conversations, lifecycle] = await Promise.all([
    orderIds.length ? prisma.invoice.findMany({ where: { tenantId, orderId: { in: orderIds } } }) : [],
    humanOrderIds.length
      ? prisma.shippingGuia.findMany({
          where: { tenantId, orderId: { in: humanOrderIds } },
          // The label PDF is listed, not embedded.
          select: {
            id: true,
            orderId: true,
            carrier: true,
            guiaNumber: true,
            trackingNumber: true,
            status: true,
            cost: true,
            weight: true,
            dimensions: true,
            serviceType: true,
            progress: true,
            pdfFileName: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : [],
    prisma.chatConversation.findMany({
      where: { tenantId, clientId },
      select: {
        id: true,
        socialAccountId: true,
        peerId: true,
        peerName: true,
        status: true,
        tags: true,
        createdAt: true,
        lastMessageAt: true,
        socialAccount: { select: { platform: true } },
      },
    }),
    prisma.clientLifecycleState.findFirst({ where: { tenantId, clientId } }),
  ])
  const conversationIds = conversations.map((c) => c.id)

  const messages = capped(
    await prisma.chatMessage.findMany({
      where: {
        tenantId,
        OR: [{ clientId }, ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])],
      },
      orderBy: { sentAt: 'asc' },
      take: EXPORT_LIMITS.messages + 1,
      select: {
        id: true,
        conversationId: true,
        direction: true,
        content: true,
        messageType: true,
        sentAt: true,
        deliveryStatus: true,
        mediaMimeType: true,
        mediaFilename: true,
        orderId: true,
      },
    }),
    EXPORT_LIMITS.messages,
    'messages',
  )

  const linkedTo = [
    { clientId },
    ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : []),
  ]
  const [notes, tasks, activity] = await Promise.all([
    prisma.crmNote.findMany({
      where: { tenantId, deletedAt: null, OR: linkedTo },
      select: { id: true, clientId: true, conversationId: true, kind: true, body: true, createdAt: true, editedAt: true },
    }),
    prisma.crmTask.findMany({
      where: { tenantId, OR: linkedTo },
      select: { id: true, clientId: true, conversationId: true, kind: true, title: true, status: true, dueAt: true, createdAt: true, completedAt: true },
    }),
    prisma.activityEvent
      .findMany({
        where: {
          tenantId,
          OR: [...linkedTo, ...(orderIds.length ? [{ orderId: { in: orderIds } }] : [])],
        },
        orderBy: { occurredAt: 'asc' },
        take: EXPORT_LIMITS.events + 1,
        select: { id: true, verb: true, entityType: true, entityId: true, orderId: true, conversationId: true, props: true, occurredAt: true },
      })
      .then((rows) => capped(rows, EXPORT_LIMITS.events, 'events')),
  ])

  // Logistics rows (raw SQL tables): only through this business's own order ids.
  let lmOrders: unknown[] = []
  let lmEvents: unknown[] = []
  if (orderIds.length) {
    if (await lmTableExists('lm_orders')) {
      lmOrders = await prisma.$queryRaw<unknown[]>`
        SELECT * FROM lm_orders WHERE crm_order_id = ANY(${orderIds}::text[]) AND crm_tenant_id = ${tenantId}`
    }
    if (await lmTableExists('lm_order_events')) {
      lmEvents = await prisma.$queryRaw<unknown[]>`
        SELECT e.* FROM lm_order_events e
        JOIN lm_orders o ON o.crm_order_id = e.crm_order_id AND o.crm_tenant_id = ${tenantId}
        WHERE e.crm_order_id = ANY(${orderIds}::text[])
        ORDER BY e.created_at ASC`
    }
  }

  return {
    format: 'betsy-customer-export',
    version: 1,
    generatedAt: new Date().toISOString(),
    law: 'Ley 8968 (Costa Rica)',
    scope: { tenantId, clientId, ordersMatchedBy: 'clientId' },
    customer,
    orders,
    invoices,
    shipping,
    logistics: { orders: lmOrders, events: lmEvents },
    conversations: conversations.map(({ socialAccount, ...c }) => ({ ...c, platform: socialAccount?.platform ?? null })),
    messages,
    notes,
    tasks,
    lifecycle,
    activity,
    counts: {
      orders: orders.length,
      invoices: invoices.length,
      shipping: shipping.length,
      logisticsOrders: lmOrders.length,
      logisticsEvents: lmEvents.length,
      conversations: conversations.length,
      messages: messages.length,
      notes: notes.length,
      tasks: tasks.length,
      activity: activity.length,
    },
  }
}

/** JSON with Dates as ISO strings and BigInt / Decimal as strings (raw SQL rows). */
export function serializeExport(data: CustomerExport): string {
  return JSON.stringify(
    data,
    (_key, value) => {
      if (typeof value === 'bigint') return value.toString()
      if (value && typeof value === 'object' && value.constructor?.name === 'Decimal') return String(value)
      return value
    },
    2,
  )
}
