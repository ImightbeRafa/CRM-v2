/**
 * Server-side Soft AI tool deps (legacy v1 path) — Order + ShippingGuia lookup.
 * Customer-facing turns (inbound hook) only ever see orders the chat's customer owns (order-ownership.ts);
 * the staff-only Probar route (update_sales) may look up any order of its tenant.
 * Does not touch staff bot paths.
 */

import { prisma } from '@/lib/db'
import type { SoftAiToolDeps } from '@/lib/soft-ai/tools'
import {
  findOwnedOrder,
  isOrderOwned,
  latestGuiaForOrderNumber,
  type OrderOwnershipContext,
} from '@/lib/soft-ai/order-ownership'

export type SoftAiServerDepsScope =
  | { tenantId: string; peerId: string; conversationId?: string | null }
  | { tenantId: string; staff: true }

const ORDER_SELECT = { id: true, orderId: true, status: true, customerName: true, clientId: true, phone: true } as const

function toFound(row: { id: string; orderId: string; status: string | null; customerName: string | null }) {
  return {
    id: row.id,
    orderNumber: String(row.orderId || row.id),
    status: String(row.status || 'unknown'),
    customerName: row.customerName || null,
  }
}

export function buildSoftAiServerDeps(scope: SoftAiServerDepsScope): SoftAiToolDeps {
  const { tenantId } = scope
  const owner: OrderOwnershipContext | null =
    'staff' in scope ? null : { tenantId, peerId: scope.peerId, conversationId: scope.conversationId ?? null }

  async function orderById(orderId: string) {
    const row = await prisma.order.findFirst({ where: { id: orderId, tenantId }, select: ORDER_SELECT })
    if (!row) return null
    if (owner && !(await isOrderOwned(owner, row))) return null
    return row
  }

  return {
    async findOrder({ orderId, orderNumberHint }) {
      if (orderId) {
        const byId = await orderById(orderId)
        if (byId) return toFound(byId)
      }
      if (!orderNumberHint) return null
      if (owner) {
        const owned = await findOwnedOrder(owner, orderNumberHint)
        return owned ? toFound(owned) : null
      }
      const hint = orderNumberHint.replace(/^ORDER[-_]?/i, '')
      const byNum = await prisma.order.findFirst({
        where: {
          tenantId,
          OR: [
            { orderId: { equals: orderNumberHint, mode: 'insensitive' } },
            { orderId: { contains: hint, mode: 'insensitive' } },
          ],
        },
        select: ORDER_SELECT,
        orderBy: { timestamp: 'desc' },
      })
      return byNum ? toFound(byNum) : null
    },

    async findGuia({ orderId, guiaNumber }) {
      if (orderId) {
        // Callers pass Order.id; ShippingGuia stores the order NUMBER.
        const order = await orderById(orderId)
        const row = order ? await latestGuiaForOrderNumber(tenantId, order.orderId) : null
        const num = row ? String(row.guiaNumber || row.trackingNumber || '') : ''
        if (row && num) {
          return { guiaNumber: num, status: row.status ? String(row.status) : null, carrier: row.carrier || 'correos', source: 'db' as const }
        }
      }
      if (guiaNumber) {
        const row = await prisma.shippingGuia.findFirst({
          where: { tenantId, status: { not: 'failed' }, OR: [{ guiaNumber }, { trackingNumber: guiaNumber }] },
          orderBy: { createdAt: 'desc' },
          select: { trackingNumber: true, guiaNumber: true, status: true, carrier: true, orderId: true },
        })
        if (!row) return null
        if (owner) {
          // A guía number alone proves nothing: its order must belong to this chat's customer.
          const order = await prisma.order.findFirst({
            where: { orderId: row.orderId, tenantId },
            select: { id: true, clientId: true, phone: true },
          })
          if (!order || !(await isOrderOwned(owner, order))) return null
        }
        const num = String(row.guiaNumber || row.trackingNumber || '')
        if (num) {
          return { guiaNumber: num, status: row.status ? String(row.status) : null, carrier: row.carrier || 'correos', source: 'db' as const }
        }
      }
      return null
    },
  }
}
