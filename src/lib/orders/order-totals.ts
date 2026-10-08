/**
 * Order totals — the ONE formula used by /ventas (ProductList) and by AI agents' quotes.
 * Copied exactly from the /ventas form (do not "fix" silently; change both together if ever needed):
 *  - line = unitPrice × qty + optionDeltas (option price deltas are added once per line, not per unit)
 *  - shipping only for EA (envío); RA (retiro) has no shipping
 *  - IVA 13% of the subtotal when the order applies IVA
 * Pure: safe for client and server.
 */

export const ORDER_IVA_RATE = 0.13

export type OrderTotalsLine = {
  productCost: number
  cantidad: number
  optionDeltas?: number
}

export type OrderTotals = { subtotal: number; shipping: number; iva: number; total: number }

export function computeOrderTotals(input: {
  products: OrderTotalsLine[]
  orderType: string
  orderShipping?: number | null
  applyOrderIVA?: boolean
}): OrderTotals {
  const subtotal = input.products.reduce(
    (sum, product) => sum + product.productCost * product.cantidad + (product.optionDeltas || 0),
    0,
  )
  const shipping = input.orderType === 'EA' ? input.orderShipping || 0 : 0
  const iva = input.applyOrderIVA ? subtotal * ORDER_IVA_RATE : 0
  const total = subtotal + shipping + iva
  return { subtotal, shipping, iva, total }
}
