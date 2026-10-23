/**
 * Exact product on an order line (lane J). Pure and client-safe.
 *
 * The Ventas quick-pick stores the inventory CATEGORY in `type` ("Parche") — that is what stock matching
 * (order-lifecycle extractInventoryRequests: `sku || type || name`) and the legacy deduction have always seen,
 * and it is deliberately left alone: making those lines resolve to an exact item would start rejecting
 * out-of-stock orders (INSUFFICIENT_STOCK), a product decision of its own.
 *
 * So the exact item travels next to it, in keys the stock matchers ignore: `itemName` (display) and
 * `inventoryItemId` (lookup). Never `sku` / `name`: the matcher reads those.
 */

import { extractOrderLines } from '@/lib/retiro-stock-utils';

export type PickedItem = { inventoryItemId: string; itemName: string; pickedType: string };

const MAX_NAME = 120;
const MAX_ID = 64;

/** Fields to keep on a form line when it was picked from inventory. */
export function pickedItemFields(item: { id?: unknown; name?: unknown }, type: string): Partial<PickedItem> {
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_NAME) : '';
  if (!id || id.length > MAX_ID || !name) return {};
  return { inventoryItemId: id, itemName: name, pickedType: type };
}

/**
 * Website order with a SKU that resolved to one inventory item of the business: productDetails that carries the
 * exact item while giving stock matching EXACTLY what it got from the product text before — the same key (the
 * site's name, trimmed) and the same count. Returns null (write no details, as before) when that cannot be
 * guaranteed: a comma in the name (the text fallback would split it) or a non-integer quantity.
 */
export function websiteProductDetails(
  product: { name: string; quantity: number },
  item: { id: string; name: string } | null,
): string | null {
  const name = String(product.name ?? '').trim();
  const qty = Number(product.quantity);
  if (!item || !name || name.includes(',') || !Number.isInteger(qty) || qty < 1) return null;
  const exact = exactItemDetail({ inventoryItemId: item.id, itemName: String(item.name ?? '').trim().slice(0, MAX_NAME) });
  if (!exact.inventoryItemId) return null;
  const details = JSON.stringify([{ type: name, cantidad: qty, ...exact }]);
  // Retiro stock parses the product text ("Parche x2", "A + B") differently from details: write details only
  // when retiro reads exactly the same lines either way.
  const fromText = extractOrderLines({ product: product.name, quantity: qty });
  const fromDetails = extractOrderLines({ product: product.name, quantity: qty, productDetails: details });
  if (JSON.stringify(fromText) !== JSON.stringify(fromDetails)) return null;
  return details;
}

/**
 * The exact-item keys to write into productDetails for a form line, or nothing when the line was not picked
 * from inventory or its name was edited afterwards (then the picked item no longer describes it).
 */
export function exactItemDetail(line: { type?: unknown; inventoryItemId?: unknown; itemName?: unknown; pickedType?: unknown }): { inventoryItemId?: string; itemName?: string } {
  const id = typeof line.inventoryItemId === 'string' ? line.inventoryItemId : '';
  const name = typeof line.itemName === 'string' ? line.itemName : '';
  if (!id || !name) return {};
  if (typeof line.pickedType === 'string' && String(line.type ?? '') !== line.pickedType) return {};
  return { inventoryItemId: id, itemName: name };
}
