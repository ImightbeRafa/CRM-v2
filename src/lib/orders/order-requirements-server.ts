/**
 * Server loader for a business's order requirements (same config the /ventas form reads, scoped by tenantId).
 */
import 'server-only'

import { getTenantPrisma } from '@/lib/prisma-tenant'
import type { OrderRequirements, OrderRequirementField } from '@/lib/orders/order-requirements'

function splitOptions(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined
  const list = raw
    .split(/[\n,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
  return list.length ? list : undefined
}

export async function loadOrderRequirements(tenantId: string): Promise<OrderRequirements> {
  const db = getTenantPrisma(tenantId)
  const [businessInfo, productFields, methods] = await Promise.all([
    db.businessInfo.findMany({
      where: { tenantId, isActive: true, required: true },
      orderBy: { order: 'asc' },
      select: { name: true, label: true, options: true },
    }),
    db.productField.findMany({
      where: { tenantId, active: true, required: true },
      orderBy: { order: 'asc' },
      select: {
        key: true,
        label: true,
        optionSet: { select: { options: { where: { tenantId, active: true }, select: { value: true } } } },
      },
    }),
    db.shippingMethod.findMany({
      where: { tenantId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, carrier: true, basePrice: true },
    }),
  ])
  const customerFields: OrderRequirementField[] = businessInfo
    .filter((f) => f.name)
    .map((f) => ({ key: f.name, label: f.label || f.name, ...(splitOptions(f.options) ? { options: splitOptions(f.options) } : {}) }))
  const productReq: OrderRequirementField[] = productFields
    // metodoEnvio is the legacy shipping picker, asked as the shipping method — not per line.
    .filter((f) => f.key !== 'metodoEnvio')
    .map((f) => {
      const options = f.optionSet?.options.map((o) => o.value).filter(Boolean).slice(0, 50)
      return { key: f.key, label: f.label || f.key, ...(options && options.length ? { options } : {}) }
    })
  return {
    customerFields,
    productFields: productReq,
    shippingMethods: methods.map((m) => ({ id: m.id, name: m.name, carrier: m.carrier, basePrice: Number(m.basePrice || 0) })),
  }
}
