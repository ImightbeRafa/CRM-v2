/**
 * An order still in progress for the Pedido inbox: paid or waiting for payment,
 * and not delivered or cancelled. Fulfillment text is mixed case across tenants.
 */

const CLOSED_ORDER_STATUSES = [
  'entregado',
  'entregada',
  'delivered',
  'completado',
  'completada',
  'retirado',
  'retirada',
  'cancelado',
  'cancelada',
  'cancelled',
  'canceled',
  'anulado',
  'anulada',
  'rechazado',
  'rechazada',
  'devuelto',
  'devuelta',
] as const

const CLOSED = new Set<string>(CLOSED_ORDER_STATUSES)

export function closedOrderStatuses(): readonly string[] {
  return CLOSED_ORDER_STATUSES
}

export function normalizeOrderStatus(status: string | null | undefined): string {
  return String(status ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

/** Empty / Pendiente / Pagado / Enviado stay open. Delivered and cancelled do not. */
export function isOpenOrderStatus(status: string | null | undefined): boolean {
  const token = normalizeOrderStatus(status)
  if (!token) return true
  return !CLOSED.has(token)
}
