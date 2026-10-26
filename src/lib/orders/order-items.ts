/**
 * Display-only view of what an order contains: one line per item, e.g.
 * "2× Parche Sleeping Melatonina 30u". Pure and client-safe.
 *
 * Source of truth is `productDetails` (JSON array written by the sales form and
 * the inventory flow) while it still matches `product` / `quantity`. Edited,
 * older or imported orders use the comma-joined `product` text, split
 * conservatively (commas, new lines, `;`). Quantities are only shown when we
 * actually know them — never invented.
 */

import { isWebItemRow, webRowsMatchOrder } from '@/lib/orders/website-items';

export type OrderItemLine = {
  name: string;
  /** null when the order text does not say how many of this item. */
  qty: number | null;
  /** Short variant info (color, size, flavor) not already in the name. */
  variant: string | null;
  label: string;
};

export type OrderItemsInput = {
  product?: string | null;
  quantity?: number | null;
  productDetails?: unknown;
  /** Order notes; older website orders only list their items here (see webCommentItems). */
  comments?: string | null;
  /** Pre-formatted labels from the list APIs (see orderItemLabels). */
  itemLines?: string[] | null;
};

const VARIANT_KEYS = ['color', 'tamano', 'size', 'sabor', 'flavor', 'variant', 'variante'] as const;
const MAX_VARIANT_LEN = 40;

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDetails(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  if (!text) return null;
  try {
    let parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function positiveInt(value: unknown): number | null {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function makeLine(name: string, qty: number | null, variant: string | null): OrderItemLine {
  const head = qty !== null ? `${qty}× ${name}` : name;
  return { name, qty, variant, label: variant ? `${head} · ${variant}` : head };
}

function variantFor(item: Record<string, unknown>, name: string): string | null {
  const seen = new Set([fold(name)]);
  const nameFolded = fold(name);
  const parts: string[] = [];
  for (const key of VARIANT_KEYS) {
    const value = item[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_VARIANT_LEN) continue;
    const folded = fold(trimmed);
    if (seen.has(folded) || nameFolded.includes(folded)) continue;
    seen.add(folded);
    parts.push(trimmed);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** A detail line plus the name as stored in `type` (what `product` was built from). */
type DetailLine = { line: OrderItemLine; stored: string };

const MAX_ITEM_NAME_LEN = 120;

function linesFromDetails(details: unknown): DetailLine[] {
  if (!Array.isArray(details)) return [];
  const lines: DetailLine[] = [];
  for (const raw of details) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const stored = String(item.type ?? item.name ?? item.product ?? '').trim();
    // `itemName` = the exact inventory item picked (Ventas, inbox prefill) or resolved from its
    // inventoryItemId; `type` may only hold a generic word like the category ("Parche").
    const exact = typeof item.itemName === 'string' ? item.itemName.trim().slice(0, MAX_ITEM_NAME_LEN) : '';
    const name = exact || stored;
    if (!name) continue;
    const qty = positiveInt(item.cantidad ?? item.quantity ?? item.qty) ?? 1;
    lines.push({ line: makeLine(name, qty, variantFor(item, name)), stored: stored || name });
  }
  return lines;
}

/**
 * productDetails is written at creation; editing an order (Pedidos › Editar,
 * the staff bot) changes product / quantity but not productDetails. Trust the
 * details only while they still match: every item name appears in the product
 * text and the item counts add up to the order quantity.
 */
function productIsMadeOf(product: string, itemNames: string[]): boolean {
  // Remove each item name (longest first); only separators and "xN" counts
  // may be left, so a rename "Parche" → "Parche Focus" is caught.
  let rest = product;
  const names = itemNames.map(fold).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const at = rest.indexOf(name);
    if (at < 0) return false;
    rest = `${rest.slice(0, at)} ${rest.slice(at + name.length)}`;
  }
  return rest.replace(/[x×]\s*\d+|\(\s*\d+\s*\)|[\s,;+&-]/g, '') === '';
}

function detailsMatchOrder(lines: DetailLine[], order: OrderItemsInput): boolean {
  const product = fold(String(order.product ?? ''));
  // `product` is built from the stored names (`type`); accept the exact names too.
  if (product && !productIsMadeOf(product, lines.map((l) => l.stored)) && !productIsMadeOf(product, lines.map((l) => l.line.name))) {
    return false;
  }
  const total = positiveInt(order.quantity);
  if (total !== null) {
    const sum = lines.reduce((acc, l) => acc + (l.line.qty ?? 0), 0);
    if (sum !== total) return false;
  }
  return true;
}

function trustedDetailLines(order: OrderItemsInput): OrderItemLine[] {
  const details = parseDetails(order.productDetails);
  const lines = linesFromDetails(details);
  if (lines.length === 0) return [];
  // A website cart keeps the site's product text and counts (bags, boxes…): trust its rows while the product
  // is still the one they were written for.
  if (Array.isArray(details) && details.some(isWebItemRow)) {
    return webRowsMatchOrder(details, order.product, order.quantity) ? lines.map((l) => l.line) : [];
  }
  return detailsMatchOrder(lines, order) ? lines.map((l) => l.line) : [];
}

/** "Parche x2", "Parche ×2", "Parche (2)", "2 Parche" → name + explicit qty. */
function parseQty(part: string): { name: string; qty: number | null } {
  const trailing = part.match(/^(.*?\S)\s*(?:[xX×]\s*(\d{1,4})|\(\s*(\d{1,4})\s*\))$/);
  if (trailing) return { name: trailing[1].trim(), qty: positiveInt(trailing[2] ?? trailing[3]) };
  const leading = part.match(/^(\d{1,4})\s*[xX×]?\s+(\D.*)$/);
  if (leading) return { name: leading[2].trim(), qty: positiveInt(leading[1]) };
  return { name: part, qty: null };
}

function linesFromText(product: string, quantity: number | null | undefined): OrderItemLine[] {
  // Split on new lines, ";" and commas, but not a decimal comma ("Pack 3,5 kg").
  // (No lookbehind: older Safari cannot parse it.)
  const DECIMAL = '\u0000';
  const parts = product
    .replace(/(\d),(\d)/g, `$1${DECIMAL}$2`)
    .split(/\r?\n|;|,/)
    .map((part) => part.split(DECIMAL).join(',').replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const total = positiveInt(quantity);
  // One item: the name stays as written ("Parches Sleeping x30" is a pack
  // size, not a count) and the order quantity is the count.
  if (parts.length === 1) return [makeLine(parts[0], total, null)];

  // Several items: per-item counts only when they add up to the order quantity.
  const parsed = parts.map(parseQty);
  const allExplicit = parsed.every((p) => p.qty !== null);
  const sum = parsed.reduce((acc, p) => acc + (p.qty ?? 0), 0);
  if (allExplicit && total !== null && sum === total) {
    return parsed.map((p) => makeLine(p.name, p.qty, null));
  }
  const oneEach = total === parts.length;
  return parts.map((part) => makeLine(part, oneEach ? 1 : null, null));
}

/** Placeholder the store websites used for carts with several items. */
const GENERIC_WEB_PRODUCT = /^pedido m[uú]ltiple\b/i;
/** "Arnés ForgeCR · Talla M/L x1 — ₡14 900" or "Combo Menta x2". */
const COMMENT_ITEM = /^(.+?)\s+[x×](\d{1,4})(?:\s+[—–-]\s+.*)?$/;
const COMMENT_STOP = /^comentarios?(?:\s+del)?\s+cliente\s*:/i;
/** COMMENT_ITEM is quadratic on long whitespace runs: only short lines of the start of the notes are read. */
const MAX_COMMENT_SCAN = 4000;
const MAX_COMMENT_LINE = 300;

/**
 * Website orders sent before the `items` intake kept their cart only in the
 * notes: a "Productos:" block (one "name xN — ₡amount" per line) or, for some
 * stores, "name xN" segments joined by " | ". Used only while the product is
 * the "Pedido múltiple" placeholder, or when the lines add up to the order
 * quantity, so ordinary notes are never read as items.
 */
export function webCommentItems(order: OrderItemsInput): OrderItemLine[] {
  const comments = String(order.comments ?? '').slice(0, MAX_COMMENT_SCAN);
  if (!comments.trim()) return [];
  const generic = GENERIC_WEB_PRODUCT.test(String(order.product ?? '').trim());
  const segments = comments.split(/\r?\n|\s\|\s/).map((s) => s.trim());
  const header = segments.findIndex((s) => /^productos\s*:?$/i.test(s));
  if (header < 0 && !generic) return [];
  const lines: OrderItemLine[] = [];
  for (const segment of header >= 0 ? segments.slice(header + 1) : segments) {
    if (COMMENT_STOP.test(segment)) break;
    const match = segment.length <= MAX_COMMENT_LINE ? segment.match(COMMENT_ITEM) : null;
    // Without a header only plain "name xN" segments count ("Pago: …" has a colon).
    if (!match || (header < 0 && match[1].includes(':'))) {
      if (header >= 0 && lines.length > 0) break;
      continue;
    }
    lines.push(makeLine(match[1].trim().slice(0, MAX_ITEM_NAME_LEN), positiveInt(match[2]), null));
  }
  // A cart is 2+ items: a single parsed line means the notes were not what we think.
  if (lines.length < 2) return [];
  if (generic) return lines;
  const total = positiveInt(order.quantity);
  const sum = lines.reduce((acc, l) => acc + (l.qty ?? 0), 0);
  return lines.length > 1 && total !== null && sum === total ? lines : [];
}

export function formatOrderItems(order: OrderItemsInput): OrderItemLine[] {
  if (Array.isArray(order.itemLines)) {
    const labels = order.itemLines.map((label) => String(label ?? '').trim()).filter(Boolean);
    if (labels.length > 0) return labels.map((label) => ({ name: label, qty: null, variant: null, label }));
  }
  const fromDetails = trustedDetailLines(order);
  if (fromDetails.length > 0) return fromDetails;
  const fromComments = webCommentItems(order);
  if (fromComments.length > 0) return fromComments;
  return linesFromText(String(order.product ?? ''), order.quantity);
}

/**
 * For list APIs: labels built from productDetails (or an older website order's
 * notes), so the client gets per-item quantities without the heavy JSON. Pass
 * product + quantity + comments too: undefined when nothing trustworthy is
 * found (the client then uses the product text).
 */
export function orderItemLabels(order: OrderItemsInput): string[] | undefined {
  const details = trustedDetailLines(order);
  const lines = details.length > 0 ? details : webCommentItems(order);
  return lines.length > 0 ? lines.map((line) => line.label) : undefined;
}

/** Full, untruncated text for tooltips / copy (one item per line). */
export function orderItemsText(order: OrderItemsInput): string {
  return formatOrderItems(order).map((line) => line.label).join('\n');
}
