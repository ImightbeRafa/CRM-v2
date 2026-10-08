/**
 * What a business's order needs — the same rules as the /ventas form, as data, so an AI agent asks for exactly
 * these fields (never assumes one). Pure: the server loader lives in order-requirements-server.ts.
 *
 * Mirrors app/ventas/components/orderFormValidation.ts:
 *  - always: name, phone
 *  - EA (envío): province, canton, district, address, shipping method
 *  - every line: product, quantity > 0, unit price > 0, seller (agents use their configured seller)
 *  - the business's own required customer fields (Config › Datos del negocio)
 * Plus: required product fields with options (e.g. talla, color) per line — /ventas only marks them in the UI;
 * agents enforce them so no order is proposed without them.
 */

export type OrderRequirementField = {
  key: string
  label: string
  /** select options when the field has a fixed list */
  options?: string[]
}

export type ShippingMethodOption = { id: string; name: string; carrier: string | null; basePrice: number }

export type OrderRequirements = {
  customerFields: OrderRequirementField[]
  productFields: OrderRequirementField[]
  shippingMethods: ShippingMethodOption[]
}

export type OrderDraft = {
  orderType: 'EA' | 'RA' | null
  customer: Record<string, string | null | undefined>
  shippingMethod?: string | null
  lines: Array<{
    product?: string | null
    quantity?: number | null
    unitPrice?: number | null
    seller?: string | null
    fields?: Record<string, string | null | undefined>
  }>
}

export type MissingOrderField = { key: string; label: string; options?: string[] }

const BASE_ALWAYS: OrderRequirementField[] = [
  { key: 'name', label: 'Nombre del cliente' },
  { key: 'phone', label: 'Teléfono' },
]

const BASE_SHIPPING: OrderRequirementField[] = [
  { key: 'province', label: 'Provincia' },
  { key: 'canton', label: 'Cantón' },
  { key: 'district', label: 'Distrito' },
  { key: 'address', label: 'Dirección exacta (otras señas)' },
]

const filled = (v: unknown) =>
  (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v))

/** Every field still missing for this draft, in the order a person would ask for them. */
export function missingOrderFields(req: OrderRequirements, draft: OrderDraft): MissingOrderField[] {
  const missing: MissingOrderField[] = []
  if (draft.orderType !== 'EA' && draft.orderType !== 'RA') {
    missing.push({ key: 'orderType', label: 'Envío o retiro', options: ['EA', 'RA'] })
  }
  if (draft.lines.length === 0) missing.push({ key: 'products', label: 'Producto' })
  draft.lines.forEach((line, i) => {
    const n = draft.lines.length > 1 ? ` #${i + 1}` : ''
    if (!filled(line.product)) missing.push({ key: `line-${i}-product`, label: `Producto${n}` })
    if (!(typeof line.quantity === 'number' && line.quantity > 0)) missing.push({ key: `line-${i}-quantity`, label: `Cantidad${n}` })
    if (!(typeof line.unitPrice === 'number' && line.unitPrice > 0)) missing.push({ key: `line-${i}-unitPrice`, label: `Precio${n}` })
    if (!filled(line.seller)) missing.push({ key: `line-${i}-seller`, label: `Vendedor${n}` })
    for (const f of req.productFields) {
      if (!filled(line.fields?.[f.key])) {
        missing.push({ key: `line-${i}-${f.key}`, label: `${f.label}${n}`, ...(f.options ? { options: f.options } : {}) })
      }
    }
  })
  for (const f of BASE_ALWAYS) {
    if (!filled(draft.customer[f.key])) missing.push({ key: f.key, label: f.label })
  }
  if (draft.orderType === 'EA') {
    for (const f of BASE_SHIPPING) {
      if (!filled(draft.customer[f.key])) missing.push({ key: f.key, label: f.label })
    }
    if (!filled(draft.shippingMethod)) {
      missing.push({
        key: 'shippingMethod',
        label: 'Método de envío',
        ...(req.shippingMethods.length ? { options: req.shippingMethods.map((m) => m.name) } : {}),
      })
    }
  }
  for (const f of req.customerFields) {
    if (BASE_ALWAYS.some((b) => b.key === f.key) || BASE_SHIPPING.some((b) => b.key === f.key)) continue
    if (!filled(draft.customer[f.key])) missing.push({ key: f.key, label: f.label, ...(f.options ? { options: f.options } : {}) })
  }
  return missing
}
