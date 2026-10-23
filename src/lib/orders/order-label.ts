/**
 * Short, human order number (#1042) — the label people read and say on the
 * phone. Pure and client-safe.
 *
 * `orderNo` is a per-business sequence assigned by the database at creation
 * (SQL 062, trigger on "Order"). The long `orderId` ("ORDER-1792711884367")
 * stays the internal/external id: URLs, guías, Correos, exports, integrations.
 * Until 062 is applied (or an old order is not backfilled yet) orderNo is
 * missing and every label falls back to the long id.
 *
 * Note: the chat DTOs already use `orderNumber` for the LONG id; this field is
 * deliberately called `orderNo`.
 */

export type OrderLabelInput = {
  orderId?: string | null;
  orderNo?: number | string | null;
};

const MAX_ORDER_NO = 9_999_999;

/** A valid stored order number, or null. */
export function normalizeOrderNo(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isInteger(n) && n > 0 && n <= MAX_ORDER_NO ? n : null;
}

/** "#1042" when the order has a short number, else the long orderId. */
export function orderLabel(order: OrderLabelInput | null | undefined): string {
  const no = normalizeOrderNo(order?.orderNo);
  if (no !== null) return `#${no}`;
  return String(order?.orderId ?? '').trim();
}

/** Same as orderLabel but the long-id fallback also gets a "#" ("#ORDER-…"), for places that always showed one. */
export function orderLabelHash(order: OrderLabelInput | null | undefined): string {
  const label = orderLabel(order);
  return label && !label.startsWith('#') ? `#${label}` : label;
}

/** The long id to show in small print next to the short label, or null when the label already is the long id. */
export function orderSecondaryId(order: OrderLabelInput | null | undefined): string | null {
  const id = String(order?.orderId ?? '').trim();
  return normalizeOrderNo(order?.orderNo) !== null && id ? id : null;
}

/**
 * A search term that is an order number: "#1042", "1042", "# 1042", "n° 1042",
 * "pedido 1042". Up to 7 digits (longer digit runs are phones / long ids).
 */
export function parseOrderNoQuery(term: string | null | undefined): number | null {
  const text = String(term ?? '').trim().toLowerCase();
  const match = text.match(/^(?:pedido\s*|orden\s*|n[°º.o]?\s*)?#?\s*(\d{1,7})$/);
  return match ? normalizeOrderNo(match[1]) : null;
}
