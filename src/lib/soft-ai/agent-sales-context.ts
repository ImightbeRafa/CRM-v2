/**
 * Loads, once per turn, what the agent needs to sell (live turn and test chat call this the same way):
 * products (inline when small), the business's shipping methods with customer price + zones + contra entrega
 * (Config › Métodos de envío is the source of truth), the order fields of /ventas, the owner's sales script and
 * payment shareability. Tenant-scoped; never unit costs. Fail-safe: any part that is missing just stays empty.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { loadSalesSetup, salesRulesForPrompt } from '@/lib/soft-ai/agent-sales-setup'
import { loadOrderRequirements } from '@/lib/orders/order-requirements-server'
import { loadCoverage } from '@/lib/shipping/coverage-store'
import type { MethodCoverage } from '@/lib/shipping/coverage'
import type { BrandFacts } from '@/lib/soft-ai/brand-facts'
import type { SalesContext } from '@/lib/soft-ai/sales-state'

const INLINE_CATALOG_MAX = 30

function placesText(places: string[]): string {
  const shown = places.slice(0, 6).map((p) => p.split('|').map((x) => x.replace(/\b\p{L}/gu, (c) => c.toUpperCase())).join(' / '))
  return shown.join(', ') + (places.length > 6 ? ` y ${places.length - 6} más` : '')
}

function coverageText(c: MethodCoverage): string {
  if (c.coverage === 'gam') return 'solo GAM'
  if (c.coverage === 'list') return c.places.length ? placesText(c.places) : 'zonas sin definir'
  return 'todo el país'
}

function codText(c: MethodCoverage): string {
  if (!c.allowsCod) return 'no'
  if (c.codCoverage === 'gam') return 'solo GAM'
  if (c.codCoverage === 'list') return c.codPlaces.length ? `solo ${placesText(c.codPlaces)}` : 'no'
  return 'sí, donde llega'
}

export async function loadAgentSalesContext(input: {
  tenantId: string
  agentId: string
  inventoryItemIds: string[] | null
  brandFacts: BrandFacts
}): Promise<SalesContext> {
  const ids = input.inventoryItemIds ?? []
  const [setup, requirements, coverage, items] = await Promise.all([
    loadSalesSetup(input.tenantId, input.agentId).catch(() => null),
    loadOrderRequirements(input.tenantId).catch(() => null),
    loadCoverage(input.tenantId).catch(() => []),
    ids.length > 0 && ids.length <= INLINE_CATALOG_MAX
      ? prisma.inventoryItem
          .findMany({
            where: { tenantId: input.tenantId, isActive: true, id: { in: ids } },
            select: { name: true, sellingPrice: true, currentStock: true, minStock: true },
            orderBy: { name: 'asc' },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ])

  const offered = new Set(setup?.offeredShippingMethodIds ?? [])
  const methods = coverage.filter((m) => offered.size === 0 || offered.has(m.shippingMethodId))
  // Config › Métodos de envío is the source of truth (Rafael 2026-10-09). A business without methods yet falls back
  // to the agent's own shipping facts so it can still quote (these amounts are already allowed by the validator).
  const ea = input.brandFacts.shipping?.ea
  const ra = input.brandFacts.shipping?.ra
  const fromFacts =
    methods.length === 0
      ? [
          ...(ea?.enabled && ea.gamCost != null
            ? [{ name: 'Envío a domicilio (GAM)', price: ea.gamCost, coverage: 'GAM', cod: input.brandFacts.shipping?.contraEntrega?.enabled ? 'según zona' : 'no' }]
            : []),
          ...(ea?.enabled && ea.outsideGamCost != null
            ? [{ name: 'Envío a domicilio (fuera de GAM)', price: ea.outsideGamCost, coverage: 'fuera de GAM', cod: 'no' }]
            : []),
          ...(ra?.enabled ? [{ name: 'Retiro en tienda', price: 0, coverage: (ra.text || 'en la tienda').slice(0, 120), cod: 'no aplica' }] : []),
        ]
      : []

  const orderFields = [
    'Nombre',
    'Teléfono',
    'Envío o retiro en tienda',
    'Provincia, cantón y distrito (si es envío)',
    'Dirección exacta con otras señas (si es envío)',
    ...(requirements?.customerFields ?? []).map((f) => f.label),
    ...(requirements?.productFields ?? []).map((f) => (f.options?.length ? `${f.label} (${f.options.slice(0, 8).join('/')})` : f.label)),
  ]

  const pay = input.brandFacts.payment
  const paymentDigits = [pay?.sinpe?.number, pay?.transfer?.iban]
    .map((n) => (n || '').replace(/\D/g, ''))
    .filter((d) => d.length >= 8)
    .map((d) => d.slice(-8))

  return {
    catalog: items
      ? items.map((i) => ({
          name: i.name,
          price: Number(i.sellingPrice),
          stockLabel: i.currentStock <= 0 ? 'agotado' : i.currentStock < i.minStock ? 'pocas unidades' : 'disponible',
        }))
      : null,
    shippingMethods: methods.length
      ? methods.map((m) => ({ name: m.name, price: Number(m.basePrice) || 0, coverage: coverageText(m), cod: codText(m) }))
      : fromFacts,
    orderFields: [...new Set(orderFields)].slice(0, 20),
    salesScript: setup ? salesRulesForPrompt(setup.salesRules) : '',
    aiDisclosure: setup?.salesRules.aiDisclosure ?? 'discreet',
    paymentShareable: pay?.shareWithCustomers === true,
    paymentDigits,
  }
}
