import 'server-only'
import { prismaRaw } from '@/lib/prisma-tenant'
import { customerLinkedWhere, customerMessageWhere, findCustomerRecords } from '@/lib/data-subject/records'

/**
 * Ley 8968 (Costa Rica) access right: everything Betsy holds about ONE customer of ONE business,
 * as a single JSON document. Read only.
 *
 * Same record set as the erasure (records.ts): orders linked to the customer OR matching their
 * phone / email (incl. archived), their chats and messages, notes, tasks. Every query carries the
 * business id. Only the customer's own data is exported: internal fields (seller, product cost,
 * logistics costs / billing / staff emails) are left out (allowlists below). Label PDFs and chat
 * media files are listed, not embedded.
 */
export const EXPORT_LIMITS = { orders: 5_000, messages: 50_000, events: 20_000 } as const
/** The whole document is built in memory: refuse anything bigger than this (413 to the owner). */
export const EXPORT_MAX_BYTES = 25 * 1024 * 1024

export class ExportTooLargeError extends Error {
  constructor(public readonly what: keyof typeof EXPORT_LIMITS | 'bytes') {
    super('EXPORT_TOO_LARGE')
  }
}

export type CustomerExport = {
  format: 'betsy-customer-export'
  version: 2
  generatedAt: string
  law: 'Ley 8968 (Costa Rica)'
  scope: { tenantId: string; clientId: string; ordersMatchedBy: 'client_or_contact' }
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
  const rows = await prismaRaw.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS ok`
  return rows[0]?.ok === true
}

/** The customer's own order fields (no seller, product cost, internal funnel or archive notes). */
const ORDER_FIELDS = {
  id: true,
  orderId: true,
  orderType: true,
  status: true,
  timestamp: true,
  updatedAt: true,
  customerName: true,
  username: true,
  phone: true,
  email: true,
  business: true,
  product: true,
  quantity: true,
  size: true,
  color: true,
  packaging: true,
  customization: true,
  comments: true,
  total: true,
  iva: true,
  shippingCost: true,
  address: true,
  province: true,
  canton: true,
  district: true,
  courier: true,
  expectedDate: true,
  agreedDate: true,
  pickupDate: true,
  saleDate: true,
  delivery: true,
  productDetails: true,
  customFields: true,
  deletedAt: true,
} as const

const CUSTOMER_FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  province: true,
  canton: true,
  district: true,
  address: true,
  business: true,
  username: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Returns null when the customer is not in this business. */
export async function buildCustomerExport(tenantId: string, clientId: string): Promise<CustomerExport | null> {
  if (!tenantId || !clientId) return null
  const records = await findCustomerRecords(tenantId, clientId)
  if (!records) return null
  const customer = await prismaRaw.client.findFirst({ where: { id: clientId, tenantId }, select: CUSTOMER_FIELDS })
  if (!customer) return null

  const orderIdsAll = records.orders.map((o) => o.id)
  capped(orderIdsAll, EXPORT_LIMITS.orders, 'orders')
  const orders = orderIdsAll.length
    ? await prismaRaw.order.findMany({ where: { tenantId, id: { in: orderIdsAll } }, orderBy: { timestamp: 'asc' }, select: ORDER_FIELDS })
    : []
  const orderIds = orders.map((o) => o.id)
  const humanOrderIds = orders.map((o) => o.orderId)
  const { conversationIds } = records

  const [invoices, shipping, conversations, lifecycle] = await Promise.all([
    orderIds.length ? prismaRaw.invoice.findMany({ where: { tenantId, orderId: { in: orderIds } } }) : [],
    humanOrderIds.length
      ? prismaRaw.shippingGuia.findMany({
          where: { tenantId, orderId: { in: humanOrderIds } },
          // The label PDF is listed, not embedded.
          select: {
            id: true,
            orderId: true,
            carrier: true,
            guiaNumber: true,
            trackingNumber: true,
            status: true,
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
    conversationIds.length
      ? prismaRaw.chatConversation.findMany({
          where: { tenantId, id: { in: conversationIds } },
          select: {
            id: true,
            peerId: true,
            peerName: true,
            status: true,
            tags: true,
            createdAt: true,
            lastMessageAt: true,
            socialAccount: { select: { platform: true } },
          },
        })
      : [],
    prismaRaw.clientLifecycleState.findFirst({ where: { tenantId, clientId } }),
  ])

  const messages = capped(
    await prismaRaw.chatMessage.findMany({
      where: customerMessageWhere(tenantId, clientId, conversationIds),
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

  const linked = customerLinkedWhere(tenantId, clientId, conversationIds)
  const [notes, tasks, activity] = await Promise.all([
    prismaRaw.crmNote.findMany({
      where: { ...linked, deletedAt: null },
      select: { id: true, clientId: true, conversationId: true, kind: true, body: true, createdAt: true, editedAt: true },
    }),
    prismaRaw.crmTask.findMany({
      where: linked,
      select: { id: true, clientId: true, conversationId: true, kind: true, title: true, status: true, dueAt: true, createdAt: true, completedAt: true },
    }),
    prismaRaw.activityEvent
      .findMany({
        where: { tenantId, OR: [...linked.OR, ...(orderIds.length ? [{ orderId: { in: orderIds } }] : [])] },
        orderBy: { occurredAt: 'asc' },
        take: EXPORT_LIMITS.events + 1,
        select: { id: true, verb: true, entityType: true, entityId: true, orderId: true, conversationId: true, props: true, occurredAt: true },
      })
      .then((rows) => capped(rows, EXPORT_LIMITS.events, 'events')),
  ])

  // Logistics (raw SQL tables, DeepSleep in-house): only delivery facts about THIS customer's
  // orders — no costs, billing, staff emails or internal notes.
  let lmOrders: unknown[] = []
  let lmEvents: unknown[] = []
  if (orderIds.length) {
    if (await lmTableExists('lm_orders')) {
      lmOrders = await prismaRaw.$queryRaw<unknown[]>`
        SELECT o.crm_order_id, o.carrier, o.tracking_number, o.recipient_province, s.name AS status, o.created_at, o.updated_at
        FROM lm_orders o
        LEFT JOIN lm_order_statuses s ON s.id = o.status_id
        WHERE o.crm_order_id = ANY(${orderIds}::text[]) AND o.crm_tenant_id = ${tenantId}`
    }
    if (await lmTableExists('lm_order_events')) {
      lmEvents = await prismaRaw.$queryRaw<unknown[]>`
        SELECT e.crm_order_id, e.event_type, e.payload->>'from' AS "from", e.payload->>'to' AS "to", e.created_at
        FROM lm_order_events e
        JOIN lm_orders o ON o.crm_order_id = e.crm_order_id AND o.crm_tenant_id = ${tenantId}
        WHERE e.crm_order_id = ANY(${orderIds}::text[])
        ORDER BY e.created_at ASC`
    }
  }

  return {
    format: 'betsy-customer-export',
    version: 2,
    generatedAt: new Date().toISOString(),
    law: 'Ley 8968 (Costa Rica)',
    scope: { tenantId, clientId, ordersMatchedBy: 'client_or_contact' },
    customer,
    orders: orders.map((o) => ({ ...o, archived: o.deletedAt !== null })),
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

/** Compact JSON (Dates as ISO, BigInt / Decimal as strings); refuses documents over the byte budget. */
export function serializeExport(data: CustomerExport, maxBytes = EXPORT_MAX_BYTES): string {
  const json = JSON.stringify(data, (_key, value) => {
    if (typeof value === 'bigint') return value.toString()
    if (value && typeof value === 'object' && value.constructor?.name === 'Decimal') return String(value)
    return value
  })
  if (Buffer.byteLength(json, 'utf8') > maxBytes) throw new ExportTooLargeError('bytes')
  return json
}
