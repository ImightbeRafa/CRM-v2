import { derivePaymentState, type PaymentStateKey } from './order-payment-status'

/** Minimal order shape the Pedidos (ORD-01) list needs. Compatible with `Sale`. */
export interface PedidoRow {
  orderId: string
  orderType: 'EA' | 'RA'
  status: string
  total: number
  customerName?: string
  phone?: string
  username?: string
  product?: string
  quantity?: number
  courier?: string
  comments?: string
  funnel?: string
  salesChannel?: string | null
  contraEntrega?: boolean
  cePaymentConfirmed?: boolean
  customFields?: unknown
}

export type PedidosTab = 'todos' | 'por_cobrar' | 'por_enviar' | 'en_transito' | 'entregados'

export const PEDIDOS_TABS: Array<{ key: PedidosTab; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'por_cobrar', label: 'Por cobrar' },
  { key: 'por_enviar', label: 'Por enviar' },
  { key: 'en_transito', label: 'En tránsito' },
  { key: 'entregados', label: 'Entregados' },
]

function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function customFieldsObject(customFields: unknown): Record<string, unknown> {
  if (!customFields) return {}
  if (typeof customFields === 'string') {
    try {
      const parsed = JSON.parse(customFields)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return typeof customFields === 'object' ? (customFields as Record<string, unknown>) : {}
}

/**
 * SINPE has no dedicated column: the bot writes "Pago: SINPE …" into comments and
 * integrations may send a payment method in customFields. Detect it from those.
 */
export function isSinpeOrder(order: Pick<PedidoRow, 'comments' | 'customFields'>): boolean {
  const fields = customFieldsObject(order.customFields)
  const method = fields.paymentMethod ?? fields.payment_method
  return /sinpe/.test(norm(method)) || /sinpe/.test(norm(order.comments))
}

export function isCorreosOrder(order: Pick<PedidoRow, 'courier'>): boolean {
  return /correos/.test(norm(order.courier))
}

export type PaymentTone = 'paid' | 'pending' | 'cod' | 'none'

export interface PaymentChip {
  key: PaymentStateKey
  label: string
  tone: PaymentTone
  collected: boolean
}

export function paymentChip(order: PedidoRow): PaymentChip {
  const state = derivePaymentState(order)
  const sinpe = isSinpeOrder(order)
  switch (state.key) {
    case 'pagado':
      return { key: state.key, label: 'Pagado', tone: 'paid', collected: true }
    case 'contra_entrega':
      return { key: state.key, label: 'Contra entrega', tone: 'cod', collected: false }
    case 'pendiente_pago':
      return {
        key: state.key,
        label: sinpe ? 'Pendiente SINPE' : 'Pendiente de pago',
        tone: 'pending',
        collected: false,
      }
    default:
      return { key: state.key, label: state.label, tone: 'none', collected: false }
  }
}

export type ShipTone = 'prep' | 'transit' | 'done' | 'pickup' | 'cancelled'

export interface ShipChip {
  label: string
  tone: ShipTone
}

/** Fulfilment stage for the Envío column, derived from `status` + order type. */
export function shipChip(order: PedidoRow): ShipChip {
  const status = norm(order.status)
  if (status === 'cancelado') return { label: 'Cancelado', tone: 'cancelled' }
  if (status === 'entregado') return { label: 'Entregado', tone: 'done' }
  if (order.orderType === 'RA') {
    return status === 'completado'
      ? { label: 'Retirado', tone: 'done' }
      : { label: 'Retiro en tienda', tone: 'pickup' }
  }
  if (status === 'enviado') {
    return { label: isCorreosOrder(order) ? 'En tránsito · Correos' : 'En tránsito', tone: 'transit' }
  }
  return { label: 'Preparando', tone: 'prep' }
}

function isShippedOrDone(status: string): boolean {
  return status === 'enviado' || status === 'entregado' || status === 'cancelado'
}

export function matchesTab(order: PedidoRow, tab: PedidosTab): boolean {
  const status = norm(order.status)
  switch (tab) {
    case 'todos':
      return true
    case 'por_cobrar':
      return status !== 'cancelado' && !paymentChip(order).collected
    case 'por_enviar':
      return order.orderType === 'EA' && !isShippedOrDone(status)
    case 'en_transito':
      return order.orderType === 'EA' && status === 'enviado'
    case 'entregados':
      return status === 'entregado'
  }
}

export function countByTab(orders: PedidoRow[]): Record<PedidosTab, number> {
  const counts: Record<PedidosTab, number> = {
    todos: 0,
    por_cobrar: 0,
    por_enviar: 0,
    en_transito: 0,
    entregados: 0,
  }
  for (const order of orders) {
    for (const tab of PEDIDOS_TABS) {
      if (matchesTab(order, tab.key)) counts[tab.key]++
    }
  }
  return counts
}

export interface PedidosKpis {
  salesTotal: number
  orderCount: number
  pendingAmount: number
  pendingCount: number
  pendingSinpeCount: number
  inTransitCount: number
  /** In-transit orders older than 3 days (by order timestamp). */
  inTransitOverdue: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function summarizePedidos(
  orders: Array<PedidoRow & { timestamp?: string }>,
  now: number = Date.now(),
): PedidosKpis {
  const kpis: PedidosKpis = {
    salesTotal: 0,
    orderCount: 0,
    pendingAmount: 0,
    pendingCount: 0,
    pendingSinpeCount: 0,
    inTransitCount: 0,
    inTransitOverdue: 0,
  }
  for (const order of orders) {
    if (norm(order.status) === 'cancelado') continue
    const total = Number(order.total) || 0
    kpis.orderCount++
    const chip = paymentChip(order)
    if (chip.collected) kpis.salesTotal += total
    if (chip.key === 'pendiente_pago') {
      kpis.pendingAmount += total
      kpis.pendingCount++
      if (isSinpeOrder(order)) kpis.pendingSinpeCount++
    }
    if (matchesTab(order, 'en_transito')) {
      kpis.inTransitCount++
      const ts = order.timestamp ? new Date(order.timestamp).getTime() : NaN
      if (!Number.isNaN(ts) && now - ts > 3 * DAY_MS) kpis.inTransitOverdue++
    }
  }
  return kpis
}

export interface ChannelChip {
  label: string
  /** Normalised family used to pick a colour dot. */
  family: 'whatsapp' | 'instagram' | 'facebook' | 'web' | 'other'
}

/** Channel label from `salesChannel` (falls back to `funnel`). `null` when neither is set. */
export function channelChip(order: Pick<PedidoRow, 'salesChannel' | 'funnel'>): ChannelChip | null {
  const raw = (order.salesChannel || order.funnel || '').trim()
  if (!raw) return null
  const key = norm(raw)
  if (key.includes('whatsapp') || key === 'wa') return { label: 'WhatsApp', family: 'whatsapp' }
  if (key.includes('instagram') || key === 'ig') return { label: 'Instagram', family: 'instagram' }
  if (key.includes('facebook') || key.includes('messenger') || key === 'fb') {
    return { label: 'Facebook', family: 'facebook' }
  }
  if (key === 'website' || key === 'web' || key.includes('sitio')) return { label: 'Web', family: 'web' }
  return { label: raw, family: 'other' }
}

export function searchPedidos<T extends PedidoRow>(orders: T[], term: string): T[] {
  const q = norm(term)
  if (!q) return orders
  return orders.filter(
    (o) =>
      norm(o.customerName).includes(q) ||
      norm(o.orderId).includes(q) ||
      norm(o.product).includes(q) ||
      (o.phone || '').includes(term.trim()),
  )
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)
  const start = (current - 1) * pageSize
  return { items: items.slice(start, start + pageSize), page: current, totalPages, total: items.length, start }
}
