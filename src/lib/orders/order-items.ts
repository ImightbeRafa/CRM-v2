/**
 * Display-only view of what an order contains: one line per item, e.g.
 * "2× Parche Sleeping Melatonina 30u". Pure and client-safe.
 *
 * Source of truth is `productDetails` (JSON array written by the sales form and
 * the inventory flow). Older or imported orders only have the comma-joined
 * `product` text, which is split conservatively (commas, new lines, `;`).
 * Quantities are only shown when we actually know them — never invented.
 */

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

function linesFromDetails(details: unknown): OrderItemLine[] {
  if (!Array.isArray(details)) return [];
  const lines: OrderItemLine[] = [];
  for (const raw of details) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = String(item.type ?? item.name ?? item.product ?? '').trim();
    if (!name) continue;
    const qty = positiveInt(item.cantidad ?? item.quantity ?? item.qty) ?? 1;
    lines.push(makeLine(name, qty, variantFor(item, name)));
  }
  return lines;
}

/** "Parche x2", "Parche ×2", "Parche (2)", "2 Parche" → name + explicit qty. */
function parseQty(part: string): { name: string; qty: number | null } {
  const name = part.replace(/^[-*•]\s*/, '').trim();
  const trailing = name.match(/^(.*?\S)\s*(?:[xX×]\s*(\d{1,4})|\(\s*(\d{1,4})\s*\))$/);
  if (trailing) return { name: trailing[1].trim(), qty: positiveInt(trailing[2] ?? trailing[3]) };
  const leading = name.match(/^(\d{1,4})\s*[xX×]?\s+(\D.*)$/);
  if (leading) return { name: leading[2].trim(), qty: positiveInt(leading[1]) };
  return { name, qty: null };
}

function linesFromText(product: string, quantity: number | null | undefined): OrderItemLine[] {
  const parts = product
    .split(/\r?\n|;|,/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const parsed = parts.map(parseQty);
  const total = positiveInt(quantity);
  if (parsed.length === 1) {
    const only = parsed[0];
    return [makeLine(only.name, only.qty ?? total, null)];
  }
  // Several items and one shared quantity: only spread it when it is exactly
  // one each; otherwise leave the per-item quantity unknown.
  const anyExplicit = parsed.some((p) => p.qty !== null);
  const oneEach = !anyExplicit && total === parsed.length;
  return parsed.map((p) => makeLine(p.name, oneEach ? 1 : p.qty, null));
}

export function formatOrderItems(order: OrderItemsInput): OrderItemLine[] {
  if (Array.isArray(order.itemLines)) {
    const labels = order.itemLines.map((label) => String(label ?? '').trim()).filter(Boolean);
    if (labels.length > 0) return labels.map((label) => ({ name: label, qty: null, variant: null, label }));
  }
  const fromDetails = linesFromDetails(parseDetails(order.productDetails));
  if (fromDetails.length > 0) return fromDetails;
  return linesFromText(String(order.product ?? ''), order.quantity);
}

/**
 * For list APIs: labels built from productDetails, so the client gets per-item
 * quantities without the heavy JSON. undefined when productDetails has no items
 * (the client then falls back to the product text it already has).
 */
export function orderItemLabels(order: OrderItemsInput): string[] | undefined {
  const lines = linesFromDetails(parseDetails(order.productDetails));
  return lines.length > 0 ? lines.map((line) => line.label) : undefined;
}

/** Full, untruncated text for tooltips / copy (one item per line). */
export function orderItemsText(order: OrderItemsInput): string {
  return formatOrderItems(order).map((line) => line.label).join('\n');
}
