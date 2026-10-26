/**
 * The cart of a website order (several items). Pure and client-safe.
 *
 * Stores used to squeeze a cart into one `product` ("Pedido múltiple (2 productos)") and list the real items
 * only in the notes. They may now also send `items` (Pura Sonrisa and Prototipo already send `lineItems` /
 * `products` with the same shape). Betsy keeps `product`, `quantity` and `productCost` exactly as the site
 * sent them and stores the items in productDetails for DISPLAY ONLY:
 *
 * - rows carry `itemName` (shown), never `type` / `name` / `sku`, so stock matching (order-lifecycle
 *   extractInventoryRequests: `sku || type || name`) finds no key and keeps reading the product text as before;
 * - rows carry `webItem: true`, which retiro stock (extractOrderLines) skips for the same reason;
 * - rows carry `webProduct` / `webQuantity` (the product text and quantity they describe), so they stop being
 *   shown once someone edits the product or quantity of the order.
 *
 * Whether a website cart should take items out of inventory is a product decision of its own: until then a
 * paid website order can never be rejected for stock because of this.
 */

import { parseCrcAmount } from '@/lib/crc-money';

export type WebsiteItem = {
  name: string;
  quantity: number;
  /** Colones per unit, when the site sent a readable amount. */
  unitPrice?: number;
  /** Colones for the whole line (tiers and combos round, so this is not always unitPrice × quantity). */
  lineTotal?: number;
  sku?: string;
  variant?: string;
};

export type WebsiteItemRow = {
  itemName: string;
  cantidad: number;
  productCost?: number;
  lineTotal?: number;
  variant?: string;
  siteSku?: string;
  webItem: true;
  webProduct: string;
  /** The order quantity as the site sent it (bags, boxes, units). */
  webQuantity: number;
};

const MAX_ITEMS = 50;
const MAX_NAME = 120;
const MAX_SKU = 64;
const MAX_VARIANT = 40;
const MAX_QTY = 10_000;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function parseItem(raw: unknown): WebsiteItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const name = text(item.name, MAX_NAME);
  const quantity = Number(item.quantity ?? item.qty);
  if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return null;
  const unitPrice = parseCrcAmount(item.unitPrice ?? item.price);
  const lineTotal = parseCrcAmount(item.lineTotal ?? item.total);
  const sku = text(item.sku, MAX_SKU);
  // Only an explicit variant: store names already carry flavors / sizes (and `flavors` may be in English).
  const variant = text(item.variant, MAX_VARIANT);
  return {
    name,
    quantity,
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...(lineTotal !== undefined ? { lineTotal } : {}),
    ...(sku ? { sku } : {}),
    ...(variant ? { variant } : {}),
  };
}

/**
 * A usable item list or undefined. Never rejects an order: a missing, oversized or partly unreadable list is
 * "no items" (the order is stored as before), never half a cart.
 */
export function parseWebsiteItems(value: unknown): WebsiteItem[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return undefined;
  const items = value.map(parseItem);
  return items.every((item): item is WebsiteItem => item !== null) ? items : undefined;
}

/** productDetails for a website cart of two or more items; null keeps today's behaviour. */
export function websiteItemsDetails(product: string, quantity: number, items: WebsiteItem[] | undefined): string | null {
  const webProduct = String(product ?? '').trim();
  if (!webProduct || !items || items.length < 2) return null;
  const webQuantity = Number(quantity);
  const rows: WebsiteItemRow[] = items.map((item) => ({
    itemName: item.name,
    cantidad: item.quantity,
    ...(item.unitPrice !== undefined ? { productCost: item.unitPrice } : {}),
    ...(item.lineTotal !== undefined ? { lineTotal: item.lineTotal } : {}),
    ...(item.variant ? { variant: item.variant } : {}),
    ...(item.sku ? { siteSku: item.sku } : {}),
    webItem: true,
    webProduct,
    webQuantity,
  }));
  return JSON.stringify(rows);
}

/** True for a row written by websiteItemsDetails. */
export function isWebItemRow(row: unknown): boolean {
  return !!row && typeof row === 'object' && (row as Record<string, unknown>).webItem === true;
}

/**
 * Website rows still describe the order only while its product text and quantity are the ones they were
 * written for (editing an order changes product / quantity, not productDetails).
 */
export function webRowsMatchOrder(rows: unknown[], product: unknown, quantity: unknown): boolean {
  const current = String(product ?? '').trim();
  const qty = Number(quantity);
  return rows.length > 0 && rows.every((row) => {
    if (!isWebItemRow(row)) return false;
    const web = row as WebsiteItemRow;
    return web.webProduct === current && web.webQuantity === qty;
  });
}
