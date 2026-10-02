import { normalizeExternalPaymentStatus, type PaymentStatusSource } from '@/lib/order-payment-status'

/**
 * Meta sales attribution (step 3) reports a sale ONLY when the payment is confirmed (Rafael,
 * 2026-10-02). Stricter than `derivePaymentState().collected`, whose fallback treats any status
 * other than "pendiente" / cancelled (e.g. "Enviado") as collected:
 * - cash on delivery: only once the cash is confirmed (`cePaymentConfirmed`) or marked paid;
 * - everything else: only an explicit "paid" payment status (customFields.paymentStatus);
 * - a cancelled / returned order never counts.
 */
const CANCELLED = new Set(['cancelado', 'cancelada', 'cancelled', 'canceled', 'anulado', 'anulada', 'rechazado', 'devuelto', 'devuelta'])

function token(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function fields(customFields: unknown): Record<string, unknown> {
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

export function isPaymentConfirmed(order: PaymentStatusSource & { deletedAt?: Date | null }): boolean {
  if (order.deletedAt) return false
  if (CANCELLED.has(token(order.status))) return false
  const f = fields(order.customFields)
  const explicit = normalizeExternalPaymentStatus(f.paymentStatus ?? f.payment_status)
  if (order.contraEntrega) return order.cePaymentConfirmed === true || explicit === 'pagado'
  return explicit === 'pagado'
}

export const SUPPORTED_CURRENCIES = ['CRC', 'USD'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

/** The business's own currency (Config › settings). Colones by default; anything else → null (skip). */
export function tenantCurrency(settings: unknown): SupportedCurrency | null {
  const raw = settings && typeof settings === 'object' ? (settings as { currency?: unknown }).currency : undefined
  const code = typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : 'CRC'
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code) ? (code as SupportedCurrency) : null
}

/** Rounded the way Meta expects: colones whole, dollars to the cent. Null for zero / invalid. */
export function eventValue(total: unknown, currency: SupportedCurrency): number | null {
  const n = typeof total === 'number' ? total : Number(total)
  if (!Number.isFinite(n) || n <= 0) return null
  return currency === 'CRC' ? Math.round(n) : Math.round(n * 100) / 100
}

/** Meta only attributes a Business Messaging event to a click from the last 7 days. */
export const ATTRIBUTION_WINDOW_DAYS = 7
