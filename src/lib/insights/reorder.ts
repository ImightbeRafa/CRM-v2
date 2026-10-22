/**
 * "Know what sells" (Lane E2) · repeat buyers + reorder reminders. Pure (no DB).
 *
 * Reorder rule: "1 unit of <product> lasts N days" (e.g. a box of 30 patches = 30 days).
 * Per customer and rule, the latest order with that product gives: runs out on
 * order date + quantity × days per unit. The list shows who runs out in the next N days
 * (and who already ran out recently and has not bought again). Nothing is sent automatically.
 */

import { addDaysToStatsDateKey } from '@/lib/statistics-dates'

export type ReorderRule = {
  id: string
  /** What the team calls it: "Parches x30". */
  label: string
  /** Match by inventory product (preferred) … */
  inventoryItemId: string | null
  /** … or by text in the order's product (case / accent-insensitive). */
  match: string | null
  /** Days one unit lasts. */
  daysPerUnit: number
}

export const REORDER_LIMITS = { rules: 30, label: 60, match: 60, minDays: 1, maxDays: 365, maxWindow: 60, maxOverdue: 60 } as const

export type ReorderOrderRow = {
  id: string
  orderNumber: string
  clientId: string | null
  customerName: string
  phone: string | null
  /** CR date key (YYYY-MM-DD) of the sale. */
  dateKey: string
  product: string | null
  quantity: number | null
  allocations: Array<{ inventoryItemId: string; quantity: number }>
}

export type ReorderDue = {
  key: string
  clientId: string | null
  customerName: string
  phone: string | null
  ruleId: string
  ruleLabel: string
  /** Order.id of that last order (used to find the chat it was linked to). */
  lastOrderId: string
  lastOrderNumber: string
  lastOrderDate: string
  units: number
  runsOutOn: string
  /** Negative = already ran out that many days ago. */
  daysLeft: number
  suggestedMessage: string
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanLabel(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  // No control characters / angle brackets: the label ends up in a chat message the team sends.
  const text = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
  return text || null
}

/**
 * Validates rules from the settings JSON or a request body. Bad entries are dropped (never thrown):
 * the list keeps working with whatever is valid.
 */
export function parseReorderRules(raw: unknown): ReorderRule[] {
  if (!Array.isArray(raw)) return []
  const out: ReorderRule[] = []
  const ids = new Set<string>()
  for (const item of raw.slice(0, REORDER_LIMITS.rules)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const id = typeof row.id === 'string' && ID_RE.test(row.id) ? row.id : null
    const label = cleanLabel(row.label, REORDER_LIMITS.label)
    const inventoryItemId = typeof row.inventoryItemId === 'string' && ID_RE.test(row.inventoryItemId) ? row.inventoryItemId : null
    const match = cleanLabel(row.match, REORDER_LIMITS.match)
    const days = typeof row.daysPerUnit === 'number' ? row.daysPerUnit : Number(row.daysPerUnit)
    if (!id || ids.has(id) || !label) continue
    if (!inventoryItemId && !match) continue
    if (!Number.isFinite(days) || days < REORDER_LIMITS.minDays || days > REORDER_LIMITS.maxDays) continue
    ids.add(id)
    out.push({ id, label, inventoryItemId, match, daysPerUnit: Math.round(days * 10) / 10 })
  }
  return out
}

/** Units of this rule's product in one order (0 = the order does not contain it). */
export function unitsForRule(order: Pick<ReorderOrderRow, 'product' | 'quantity' | 'allocations'>, rule: ReorderRule): number {
  if (rule.inventoryItemId) {
    const units = order.allocations
      .filter((a) => a.inventoryItemId === rule.inventoryItemId)
      .reduce((sum, a) => sum + (Number.isFinite(a.quantity) && a.quantity > 0 ? a.quantity : 0), 0)
    if (units > 0) return units
  }
  if (rule.match) {
    const needle = normalizeText(rule.match)
    if (needle && normalizeText(order.product).includes(needle)) {
      const q = Number(order.quantity)
      return Number.isFinite(q) && q > 0 ? Math.min(q, 1000) : 1
    }
  }
  return 0
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000)
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  // Instagram-style "@handle" or empty → no name in the greeting.
  return first && !first.startsWith('@') ? first.slice(0, 30) : ''
}

/** Suggested text the team can copy into the chat (never sent automatically). */
export function suggestedReorderMessage(customerName: string, label: string, daysLeft: number): string {
  const name = firstName(customerName)
  const hello = name ? `¡Hola ${name}!` : '¡Hola!'
  if (daysLeft < 0) {
    return `${hello} ¿Cómo le ha ido con ${label}? Por la fecha de su último pedido ya se le deben haber terminado. ¿Le preparo otro pedido?`
  }
  return `${hello} ¿Cómo le ha ido con ${label}? Por la fecha de su último pedido pronto se le van a terminar. ¿Le preparo otro para que no se quede sin?`
}

function customerKey(order: Pick<ReorderOrderRow, 'clientId' | 'phone' | 'customerName'>): string {
  if (order.clientId) return `c:${order.clientId}`
  const digits = (order.phone ?? '').replace(/\D/g, '')
  if (digits.length >= 8) return `p:${digits.slice(-8)}`
  return `n:${normalizeText(order.customerName)}`
}

/**
 * Customers whose product runs out between `overdueDays` ago and `windowDays` from today.
 * Uses each customer's latest order containing the product.
 */
export function buildReorderList(input: {
  orders: readonly ReorderOrderRow[]
  rules: readonly ReorderRule[]
  todayKey: string
  windowDays: number
  overdueDays: number
}): ReorderDue[] {
  const latest = new Map<string, { order: ReorderOrderRow; units: number; rule: ReorderRule }>()
  for (const rule of input.rules) {
    for (const order of input.orders) {
      const units = unitsForRule(order, rule)
      if (units <= 0) continue
      const key = `${customerKey(order)}|${rule.id}`
      const prev = latest.get(key)
      if (!prev || order.dateKey > prev.order.dateKey || (order.dateKey === prev.order.dateKey && order.orderNumber > prev.order.orderNumber)) {
        latest.set(key, { order, units, rule })
      }
    }
  }

  const out: ReorderDue[] = []
  for (const [key, { order, units, rule }] of latest) {
    const days = Math.max(1, Math.round(units * rule.daysPerUnit))
    const runsOutOn = addDaysToStatsDateKey(order.dateKey, days)
    const daysLeft = daysBetweenKeys(input.todayKey, runsOutOn)
    if (daysLeft > input.windowDays || daysLeft < -input.overdueDays) continue
    out.push({
      key,
      clientId: order.clientId,
      customerName: order.customerName,
      phone: order.phone,
      ruleId: rule.id,
      ruleLabel: rule.label,
      lastOrderId: order.id,
      lastOrderNumber: order.orderNumber,
      lastOrderDate: order.dateKey,
      units,
      runsOutOn,
      daysLeft,
      suggestedMessage: suggestedReorderMessage(order.customerName, rule.label, daysLeft),
    })
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft || a.customerName.localeCompare(b.customerName))
  return out
}

/**
 * wa.me link for a Costa Rica number (8 digits, optional 506), used only when the customer has no chat
 * in Betsy. Anything else → null (we never guess other countries).
 */
export function crWhatsAppHref(phone: string | null | undefined, text?: string): string | null {
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('506')) digits = digits.slice(3)
  if (!/^[245678]\d{7}$/.test(digits)) return null
  return `https://wa.me/506${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function clampWindowDays(raw: unknown, fallback = 7): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(REORDER_LIMITS.maxWindow, Math.max(0, Math.round(n)))
}

/** How far back to look for orders so every rule's longest supply fits. */
export function reorderLookbackDays(rules: readonly ReorderRule[], overdueDays: number): number {
  const longest = rules.reduce((max, r) => Math.max(max, r.daysPerUnit), 0)
  // A few units per order are common (2 boxes = 60 days); cap at ~13 months.
  return Math.min(400, Math.ceil(longest * 4) + overdueDays + 1)
}
