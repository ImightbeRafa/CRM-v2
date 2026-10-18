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
import { canSharePaymentFacts, paymentLabelOptions, paymentMethodsOf, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { shippingFromFacts, type SalesContext } from '@/lib/soft-ai/sales-state'
import { promoInEffect } from '@/lib/soft-ai/promo'
import { PICKUP_DATA_FIELDS, SHIPPING_DATA_FIELDS } from '@/lib/soft-ai/order-data-list'
import { loadAgentStock } from '@/lib/soft-ai/product-availability'
import { bundleHasSoldOut, buildStockGuard, soldOutLabel } from '@/lib/soft-ai/product-availability-core'

const INLINE_CATALOG_MAX = 30
/**
 * Customer fields that ARE one of the fixed shipping list's (a business field "Correo" is not asked twice). Whole label
 * only: "Nombre de quien recibe" or "Teléfono alterno" stay.
 */
const BASE_FIELD_RE =
  /^\s*(nombre( completo)?|tel[eé]fono|celular|correo( electr[oó]nico)?|e-?mail|provincia|cant[oó]n|distrito|direcci[oó]n( exacta)?( con (otras )?señas)?)\s*$/i

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
  /**
   * N5 / V4: rethrow read failures instead of falling back (the test suite builder: a failed read must fail the run,
   * never build a different suite and hash). Live turns keep the fail-soft default.
   */
  strict?: boolean
}): Promise<SalesContext> {
  const ids = input.inventoryItemIds ?? []
  const soft = <T,>(fallback: T) => (error: unknown): T => {
    if (input.strict) throw error
    return fallback
  }
  const [setup, requirements, coverage, items, stockRead] = await Promise.all([
    loadSalesSetup(input.tenantId, input.agentId).catch(soft(null)),
    loadOrderRequirements(input.tenantId).catch(soft(null)),
    loadCoverage(input.tenantId).catch(soft([] as Awaited<ReturnType<typeof loadCoverage>>)),
    ids.length > 0 && ids.length <= INLINE_CATALOG_MAX
      ? prisma.inventoryItem
          .findMany({
            where: { tenantId: input.tenantId, isActive: true, id: { in: ids } },
            select: { id: true, name: true, category: true, sellingPrice: true, currentStock: true, minStock: true },
            orderBy: { name: 'asc' },
          })
          .catch(soft(null))
      : Promise.resolve(null),
    // Out-of-stock switch (SQL 055): all of the agent's products, not only the inline ones (search_inventory too).
    loadAgentStock(input.tenantId, ids).catch(soft(null)),
  ])
  // SecureDog L3: a failed switch read still marks stock-0 products of the inline list sold out (never "disponible").
  const stock = stockRead ?? buildStockGuard(items ?? [], new Map())

  const offered = new Set(setup?.offeredShippingMethodIds ?? [])
  const methods = coverage.filter((m) => offered.size === 0 || offered.has(m.shippingMethodId))
  // Config › Métodos de envío is the source of truth (Rafael 2026-10-09). A business without methods yet falls back
  // to the agent's own shipping facts so it can still quote (these amounts are already allowed by the validator).
  const fromFacts = methods.length === 0 ? shippingFromFacts(input.brandFacts.shipping) : []

  // Rafael 2026-10-16: the shipping data is this exact list (order-data-list.ts); code rewrites any other wording.
  const orderFields = [
    ...(input.brandFacts.shipping?.ra?.enabled ? ['Envío o retiro en tienda'] : []),
    `Si es envío, exactamente: ${SHIPPING_DATA_FIELDS.join(' / ')}`,
    ...(input.brandFacts.shipping?.ra?.enabled ? [`Si es retiro: ${PICKUP_DATA_FIELDS.join(' / ')}`] : []),
    ...(requirements?.customerFields ?? []).filter((f) => !BASE_FIELD_RE.test(f.label)).map((f) => f.label),
    ...(requirements?.productFields ?? []).map((f) => (f.options?.length ? `${f.label} (${f.options.slice(0, 8).join('/')})` : f.label)),
  ]

  const pay = input.brandFacts.payment
  const paymentDigits = [pay?.sinpe?.number, pay?.transfer?.iban]
    .map((n) => (n || '').replace(/\D/g, ''))
    .filter((d) => d.length >= 8)
    .map((d) => d.slice(-8))

  // Owner promotion in effect: code applies it to prices (the model only repeats them).
  const promo = setup?.salesRules.promo && promoInEffect(setup.salesRules.promo) ? setup.salesRules.promo : null
  const specialFor = (i: { id: string; category: string | null }) =>
    promo?.specialPrices.find((sp) => (sp.ref.trim() !== '' && (sp.scope === 'item' ? sp.ref === i.id : (i.category || '').trim().toLowerCase() === sp.ref.trim().toLowerCase())))?.price
  const freeMethod = (id: string | null) =>
    Boolean(promo?.freeShipping) && (promo!.freeShippingMethodIds.length === 0 || (id !== null && promo!.freeShippingMethodIds.includes(id)))
  const shippingMethods = (
    methods.length
      ? methods.map((m) => ({ id: m.shippingMethodId as string | null, name: m.name, price: Number(m.basePrice) || 0, coverage: coverageText(m), cod: codText(m) }))
      : fromFacts.map((m) => ({ id: null as string | null, ...m }))
  ).map(({ id, ...m }) => (freeMethod(id) && m.price > 0 ? { ...m, price: 0, name: `${m.name} — gratis (promoción)` } : m))

  return {
    promo: promo
      ? { freeShipping: promo.freeShipping, specialPrice: promo.specialPrices.length > 0, codHighlight: promo.codHighlight, headline: promo.headline }
      : null,
    catalog: items
      ? items.map((i) => {
          const price = specialFor(i) ?? Number(i.sellingPrice)
          // Sold out (owner switch, or stock 0 in a store that tracks stock): its price is never shown or quotable.
          if (stock.soldOutIds.has(i.id)) return { name: i.name, price, soldOut: true, stockLabel: soldOutLabel(stock.backById.get(i.id) ?? null) }
          // Stock 0 in a store that does not track stock is just the default value: not "agotado".
          return { name: i.name, price, stockLabel: i.currentStock > 0 && i.currentStock < i.minStock ? 'pocas unidades' : 'disponible' }
        })
      : null,
    stock: stock.guard,
    shippingMethods,
    // A combo whose name contains a sold-out product's whole name is not offered (combos have no product link).
    bundles: (setup?.salesRules.bundles ?? []).filter((b) => !bundleHasSoldOut(b.name, stock.guard.soldOut.map((x) => x.name))).map((b) => ({
      name: b.name,
      price: b.price,
      // The owner's own flag; a promo counts only when it frees EVERY method (a GAM-only promo is not "included").
      shippingIncluded: b.shippingIncluded === true || Boolean(promo?.freeShipping && promo.freeShippingMethodIds.length === 0),
    })),
    orderFields: [...new Set(orderFields)].slice(0, 20),
    salesScript: setup ? salesRulesForPrompt(setup.salesRules) : '',
    aiDisclosure: setup?.salesRules.aiDisclosure ?? 'discreet',
    // Shareable = switch on AND the details exist (never ask the model to give details that aren't configured).
    paymentShareable: canSharePaymentFacts(input.brandFacts),
    paymentDigits,
    // agents2-format: the method question offers only these (+ contra entrega when a shipping method allows it).
    paymentMethods: paymentMethodsOf(input.brandFacts),
    cardOnWeb: paymentLabelOptions(input.brandFacts).cardOnWeb,
    codGamOnly: paymentLabelOptions(input.brandFacts).codGamOnly,
  }
}
