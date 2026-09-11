/**
 * Server-side Soft AI tool deps — Order + ShippingGuia lookup.
 * Correos live track is optional; falls back to honest stub in tools.
 * Does not touch staff bot paths.
 */

import { prisma } from '@/lib/db'
import type { SoftAiToolDeps } from '@/lib/soft-ai/tools'

export function buildSoftAiServerDeps(tenantId: string): SoftAiToolDeps {
  const db = prisma as any

  return {
    async findOrder({ orderId, orderNumberHint }) {
      if (orderId) {
        const byId = await db.order.findFirst({
          where: { id: orderId, tenantId },
          select: {
            id: true,
            orderId: true,
            status: true,
            customerName: true,
          },
        })
        if (byId) {
          return {
            id: byId.id,
            orderNumber: String(byId.orderId || byId.id),
            status: String(byId.status || 'unknown'),
            customerName: byId.customerName || null,
          }
        }
      }
      if (orderNumberHint) {
        const hint = orderNumberHint.replace(/^ORDER[-_]?/i, '')
        const byNum = await db.order.findFirst({
          where: {
            tenantId,
            OR: [
              { orderId: { equals: orderNumberHint, mode: 'insensitive' } },
              { orderId: { contains: hint, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            orderId: true,
            status: true,
            customerName: true,
          },
          orderBy: { timestamp: 'desc' },
        })
        if (byNum) {
          return {
            id: byNum.id,
            orderNumber: String(byNum.orderId || byNum.id),
            status: String(byNum.status || 'unknown'),
            customerName: byNum.customerName || null,
          }
        }
      }
      return null
    },

    async findGuia({ orderId, guiaNumber }) {
      if (orderId) {
        const row = await db.shippingGuia.findFirst({
          where: { orderId, tenantId },
          orderBy: { createdAt: 'desc' },
          select: {
            trackingNumber: true,
            guiaNumber: true,
            status: true,
            carrier: true,
          },
        })
        if (row) {
          const num = String(row.guiaNumber || row.trackingNumber || '')
          if (num) {
            return {
              guiaNumber: num,
              status: row.status ? String(row.status) : null,
              carrier: row.carrier ? String(row.carrier) : 'correos',
              source: 'db' as const,
            }
          }
        }
      }
      if (guiaNumber) {
        const row = await db.shippingGuia.findFirst({
          where: {
            tenantId,
            OR: [{ guiaNumber }, { trackingNumber: guiaNumber }],
          },
          orderBy: { createdAt: 'desc' },
          select: {
            trackingNumber: true,
            guiaNumber: true,
            status: true,
            carrier: true,
          },
        })
        if (row) {
          const num = String(row.guiaNumber || row.trackingNumber || '')
          if (num) {
            return {
              guiaNumber: num,
              status: row.status ? String(row.status) : null,
              carrier: row.carrier ? String(row.carrier) : 'correos',
              source: 'db' as const,
            }
          }
        }
      }
      return null
    },
  }
}
