/**
 * "Pagos por confirmar" (Pedidos): every order whose money still has to be confirmed by a person,
 * whatever day it was sold. Two kinds, both confirmable with POST /api/orders/confirm-payment:
 * - contra entrega not confirmed yet (same rule as the Inicio card, so both show the same count);
 * - prepaid SINPE still waiting for the receipt (last PENDING_PAYMENT_LOOKBACK_DAYS days).
 */
import {
  derivePaymentState,
  isCancelledFulfillment,
  isSinpeEvidence,
  type PaymentStatusSource,
} from '@/lib/order-payment-status'

/**
 * Contra entrega no longer waiting for cash: finished, cancelled or returned to the store. Shared by the
 * Inicio card (api/dashboard/stats) and this list, so both always say the same number.
 */
export const COD_CLOSED_STATUSES = ['Completado', 'Entregado', 'Cancelado', 'Rechazado', 'Devuelto', 'Anulado']

/** Inicio's "N pagos contra entrega por confirmar" and the contra entrega half of this list. */
export function codPendingWhere() {
  return { contraEntrega: true, cePaymentConfirmed: false, status: { notIn: COD_CLOSED_STATUSES } }
}

/** Older SINPE orders still "pendiente" are almost always abandoned carts, not money to chase. */
export const PENDING_PAYMENT_LOOKBACK_DAYS = 60

/** Upper bound on rows read for the list (oldest first, so the cap drops the newest, never the oldest). */
export const PENDING_PAYMENT_MAX_ROWS = 1000

/** customFields.paymentStatus values that mean "waiting" (order-payment-status WAITING_TOKENS). */
const WAITING_STATUS_VALUES = ['pending', 'Pending', 'waiting', 'unpaid', 'pendiente', 'Pendiente', 'pendiente_pago', 'awaiting']

export type PendingPaymentKind = 'contra_entrega' | 'sinpe'

/** Prisma `where` for the candidates (tenant filter is injected by the tenant client). */
export function pendingPaymentWhere(now: Date = new Date()) {
  const since = new Date(now.getTime() - PENDING_PAYMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  return {
    OR: [
      codPendingWhere(),
      {
        contraEntrega: false,
        timestamp: { gte: since },
        status: { notIn: ['Cancelado', 'Rechazado', 'Devuelto', 'Anulado'] },
        // Narrow in SQL to SINPE that can still be waiting (paid SINPE would crowd the cap);
        // `pendingPaymentKind` below is the real rule.
        AND: [
          {
            OR: [
              { comments: { contains: 'sinpe', mode: 'insensitive' as const } },
              ...['SINPE', 'Sinpe', 'sinpe'].flatMap((needle) => [
                { customFields: { path: ['paymentMethod'], string_contains: needle } },
                { customFields: { path: ['payment_method'], string_contains: needle } },
              ]),
            ],
          },
          {
            OR: [
              { status: 'Pendiente' },
              ...WAITING_STATUS_VALUES.flatMap((value) => [
                { customFields: { path: ['paymentStatus'], equals: value } },
                { customFields: { path: ['payment_status'], equals: value } },
              ]),
            ],
          },
        ],
      },
    ],
  }
}

type PendingSource = PaymentStatusSource & { comments?: string | null }

/** Which confirmation this order still needs, or null when there is nothing to confirm. */
export function pendingPaymentKind(order: PendingSource): PendingPaymentKind | null {
  if (isCancelledFulfillment(order.status)) return null
  const state = derivePaymentState(order)
  if (order.contraEntrega) {
    // Same as Inicio (SQL on the two columns): an explicit "paid" note does not hide an unconfirmed one.
    if (order.cePaymentConfirmed) return null
    return COD_CLOSED_STATUSES.includes(String(order.status ?? '')) ? null : 'contra_entrega'
  }
  return state.key === 'pendiente_pago' && isSinpeEvidence(order) ? 'sinpe' : null
}

/** Whole days since the order (Costa Rica calendar does not matter for "hace N días"). */
export function daysWaiting(timestamp: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!timestamp) return null
  const t = new Date(timestamp).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000)))
}
