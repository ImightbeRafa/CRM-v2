/**
 * "Know what sells" (Lane E2) · CRM tools: repeat buyers and reorder reminders. Server only.
 *
 * Tenant isolation: Prisma reads go through getTenantPrisma AND pass tenantId; raw SQL carries
 * `"tenantId" = ${tenantId}` on every table. Reorder rules live in Tenant.settings.reorderRules and are
 * written with jsonb_set under SELECT … FOR UPDATE, so concurrent writers of other settings keys
 * (config/settings, billing webhooks, quick replies) never lose or overwrite each other.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { getCurrentStatsDateKey, getOrderStatsDateKey, addDaysToStatsDateKey, buildStatsDateRange } from '@/lib/statistics-dates'
import { isCancelledFulfillment } from '@/lib/order-payment-status'
import { queryWithTimeout } from '@/lib/soft-ai/safe-query'
import { InsightsTooLargeError, ORDER_CAP } from '@/lib/insights/insights-server'
import {
  buildReorderList,
  parseReorderRules,
  reorderLookbackDays,
  crWhatsAppHref,
  type ReorderDue,
  type ReorderRule,
} from '@/lib/insights/reorder'

export const REORDER_SETTINGS_KEY = 'reorderRules'

function readSettingsRules(settings: unknown): ReorderRule[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []
  return parseReorderRules((settings as Record<string, unknown>)[REORDER_SETTINGS_KEY])
}

export async function loadReorderRules(tenantId: string): Promise<ReorderRule[]> {
  const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  return readSettingsRules(row?.settings)
}

/** Replaces this business's reorder rules (already validated); only the reorderRules key changes. */
export async function saveReorderRules(tenantId: string, rules: ReorderRule[]): Promise<ReorderRule[]> {
  const clean = parseReorderRules(rules)
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE
    `
    if (!rows.length) throw new Error('TENANT_NOT_FOUND')
    await tx.$executeRaw`
      UPDATE "Tenant"
      SET "settings" = jsonb_set(
        CASE WHEN jsonb_typeof("settings") = 'object' THEN "settings" ELSE '{}'::jsonb END,
        '{reorderRules}', ${JSON.stringify(clean)}::jsonb, true
      )
      WHERE "id" = ${tenantId}
    `
  })
  return clean
}

/** Products the rule editor can pick from (this business only). */
export async function loadReorderProducts(tenantId: string): Promise<Array<{ id: string; name: string; sku: string }>> {
  return getTenantPrisma(tenantId).inventoryItem.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, sku: true },
    orderBy: { name: 'asc' },
    take: 500,
  })
}

// ── Chat links ───────────────────────────────────────────────────────────────────────────────────

function last8(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-8) : null
}

type ChatLinkCustomer = { clientId: string | null; phone: string | null; orderId?: string | null }

/** Already resolved by its client id or its order id. */
function resolved(links: ReadonlyMap<string, string>, c: ChatLinkCustomer): boolean {
  return Boolean((c.clientId && links.has(c.clientId)) || (c.orderId && links.has(`o:${c.orderId}`)))
}

/**
 * The most recent chat of each customer, first match wins:
 * 1. a chat linked to the Client; 2. the latest chat any of the client's orders was linked to
 * (ChatMessage.orderId); 3. the chat the given order was linked to; 4. a WhatsApp chat whose number ends
 * with the same 8 digits (CR numbers). Keys: clientId, `o:<orderId>`, `p:<last8>`.
 */
export async function loadChatLinks(tenantId: string, customers: ReadonlyArray<ChatLinkCustomer>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const clientIds = [...new Set(customers.map((c) => c.clientId).filter((id): id is string => Boolean(id)))]
  if (clientIds.length) {
    const rows = await queryWithTimeout<Array<{ clientId: string; id: string }>>(Prisma.sql`
      SELECT DISTINCT ON (c."clientId") c."clientId", c."id"
        FROM public."ChatConversation" c
       WHERE c."tenantId" = ${tenantId}
         AND c."clientId" = ANY(${clientIds}::text[])
       ORDER BY c."clientId", c."lastMessageAt" DESC`)
    for (const r of rows) out.set(r.clientId, r.id)
  }
  const viaOrders = clientIds.filter((id) => !out.has(id))
  if (viaOrders.length) {
    const rows = await queryWithTimeout<Array<{ clientId: string; id: string }>>(Prisma.sql`
      SELECT DISTINCT ON (o."clientId") o."clientId", cm."conversationId" AS "id"
        FROM public."Order" o
        JOIN public."ChatMessage" cm ON cm."orderId" = o."id" AND cm."tenantId" = ${tenantId}
       WHERE o."tenantId" = ${tenantId}
         AND o."clientId" = ANY(${viaOrders}::text[])
         AND o."deletedAt" IS NULL
         AND cm."conversationId" IS NOT NULL
       ORDER BY o."clientId", cm."sentAt" DESC`)
    for (const r of rows) out.set(r.clientId, r.id)
  }
  const orderIds = [...new Set(customers.filter((c) => !resolved(out, c) && c.orderId).map((c) => c.orderId as string))]
  if (orderIds.length) {
    const rows = await queryWithTimeout<Array<{ orderId: string; id: string }>>(Prisma.sql`
      SELECT DISTINCT ON (cm."orderId") cm."orderId", cm."conversationId" AS "id"
        FROM public."ChatMessage" cm
       WHERE cm."tenantId" = ${tenantId}
         AND cm."orderId" = ANY(${orderIds}::text[])
         AND cm."conversationId" IS NOT NULL
       ORDER BY cm."orderId", cm."sentAt" DESC`)
    for (const r of rows) out.set(`o:${r.orderId}`, r.id)
  }
  const phones = [
    ...new Set(
      customers
        .filter((c) => !resolved(out, c))
        .map((c) => last8(c.phone))
        .filter((p): p is string => Boolean(p)),
    ),
  ]
  if (phones.length) {
    const rows = await queryWithTimeout<Array<{ tail: string; id: string }>>(Prisma.sql`
      SELECT DISTINCT ON (tail) tail, id FROM (
        SELECT right(regexp_replace(c."peerId", '\\D', '', 'g'), 8) AS tail, c."id" AS id, c."lastMessageAt"
          FROM public."ChatConversation" c
          JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
         WHERE c."tenantId" = ${tenantId}
           AND s."platform" = 'whatsapp'
      ) x
       WHERE tail = ANY(${phones}::text[])
       ORDER BY tail, "lastMessageAt" DESC`)
    for (const r of rows) out.set(`p:${r.tail}`, r.id)
  }
  return out
}

export function chatLinkFor(links: ReadonlyMap<string, string>, customer: ChatLinkCustomer): string | null {
  const tail = last8(customer.phone)
  const id =
    (customer.clientId && links.get(customer.clientId)) ||
    (customer.orderId && links.get(`o:${customer.orderId}`)) ||
    (tail && links.get(`p:${tail}`)) ||
    null
  return id ? `/chats?c=${encodeURIComponent(id)}` : null
}

// ── 4a. Repeat buyers ────────────────────────────────────────────────────────────────────────────

export type RepeatBuyer = {
  clientId: string
  name: string
  phone: string | null
  totalOrders: number
  totalSpent: number
  firstOrder: string
  lastOrder: string
  daysSinceLast: number
  chatHref: string | null
  /** wa.me fallback when there is no chat in Betsy (CR numbers only). */
  whatsappHref: string | null
}

export const REPEAT_SORTS = ['recientes', 'gasto', 'pedidos', 'dormidos'] as const
export type RepeatSort = (typeof REPEAT_SORTS)[number]

export async function loadRepeatBuyers(input: {
  tenantId: string
  sort: RepeatSort
  page: number
  pageSize: number
  now?: Date
}): Promise<{ total: number; rows: RepeatBuyer[] }> {
  const { tenantId } = input
  const db = getTenantPrisma(tenantId)
  const where = { tenantId, isActive: true, totalOrders: { gte: 2 } }
  const orderBy =
    input.sort === 'gasto'
      ? [{ totalSpent: 'desc' as const }, { id: 'asc' as const }]
      : input.sort === 'pedidos'
        ? [{ totalOrders: 'desc' as const }, { id: 'asc' as const }]
        : input.sort === 'dormidos'
          ? [{ lastOrder: 'asc' as const }, { id: 'asc' as const }]
          : [{ lastOrder: 'desc' as const }, { id: 'asc' as const }]
  const [total, clients] = await Promise.all([
    db.client.count({ where }),
    db.client.findMany({
      where,
      orderBy,
      skip: input.page * input.pageSize,
      take: input.pageSize,
      select: { id: true, name: true, phone: true, totalOrders: true, totalSpent: true, firstOrder: true, lastOrder: true },
    }),
  ])
  const links = await loadChatLinks(tenantId, clients.map((c) => ({ clientId: c.id, phone: c.phone })))
  const todayKey = getCurrentStatsDateKey(input.now)
  const today = Date.parse(`${todayKey}T00:00:00Z`)
  return {
    total,
    rows: clients.map((c) => {
      const lastKey = getCurrentStatsDateKey(c.lastOrder)
      const chatHref = chatLinkFor(links, { clientId: c.id, phone: c.phone })
      return {
        clientId: c.id,
        name: c.name,
        phone: c.phone || null,
        totalOrders: c.totalOrders,
        totalSpent: Number.isFinite(c.totalSpent) ? c.totalSpent : 0,
        firstOrder: getCurrentStatsDateKey(c.firstOrder),
        lastOrder: lastKey,
        daysSinceLast: Math.max(0, Math.round((today - Date.parse(`${lastKey}T00:00:00Z`)) / 86_400_000)),
        chatHref,
        whatsappHref: chatHref ? null : crWhatsAppHref(c.phone),
      }
    }),
  }
}

// ── 4b. Reorder reminders ────────────────────────────────────────────────────────────────────────

export type ReorderDueRow = Omit<ReorderDue, 'lastOrderId'> & { chatHref: string | null; whatsappHref: string | null }

export async function loadReorderDue(input: {
  tenantId: string
  windowDays: number
  overdueDays: number
  now?: Date
}): Promise<{ rules: ReorderRule[]; rows: ReorderDueRow[]; todayKey: string; lookbackDays: number }> {
  const { tenantId } = input
  const rules = await loadReorderRules(tenantId)
  const todayKey = getCurrentStatsDateKey(input.now)
  const lookbackDays = reorderLookbackDays(rules, input.overdueDays)
  if (rules.length === 0) return { rules, rows: [], todayKey, lookbackDays }

  const since = buildStatsDateRange(addDaysToStatsDateKey(todayKey, -lookbackDays), todayKey).start
  const orders = await getTenantPrisma(tenantId).order.findMany({
    where: { tenantId, timestamp: { gte: since ?? undefined } },
    select: {
      id: true,
      orderId: true,
      clientId: true,
      customerName: true,
      phone: true,
      product: true,
      quantity: true,
      saleDate: true,
      timestamp: true,
      status: true,
      inventoryAllocations: { where: { tenantId }, select: { inventoryItemId: true, quantity: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: ORDER_CAP + 1,
  })
  if (orders.length > ORDER_CAP) throw new InsightsTooLargeError()

  const due = buildReorderList({
    rules,
    todayKey,
    windowDays: input.windowDays,
    overdueDays: input.overdueDays,
    orders: orders
      .filter((o) => !isCancelledFulfillment(o.status))
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderId,
        clientId: o.clientId,
        customerName: o.customerName,
        phone: o.phone,
        dateKey: getOrderStatsDateKey(o) || getCurrentStatsDateKey(o.timestamp),
        product: o.product,
        quantity: o.quantity,
        allocations: o.inventoryAllocations,
      })),
  })
  const customers = due.map((d) => ({ clientId: d.clientId, phone: d.phone, orderId: d.lastOrderId }))
  const links = await loadChatLinks(tenantId, customers)
  return {
    rules,
    todayKey,
    lookbackDays,
    // lastOrderId is only for the lookup; the browser gets the chat link, not internal ids.
    rows: due.map(({ lastOrderId, ...d }) => {
      const chatHref = chatLinkFor(links, { clientId: d.clientId, phone: d.phone, orderId: lastOrderId })
      return { ...d, chatHref, whatsappHref: chatHref ? null : crWhatsAppHref(d.phone, d.suggestedMessage) }
    }),
  }
}
