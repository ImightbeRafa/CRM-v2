export type RetiroOrderLine = {
  rawName: string;
  qty: number;
  sku: string | null;
  displayName: string | null;
};

export type RetiroMappingSlot = RetiroOrderLine & {
  slotKey: string;
  unitHint: string | null;
};

export type RetiroAllocationRow = {
  slotKey: string;
  sku: string;
  qty: number;
  rawName: string;
  displayName?: string | null;
};

const DETAIL_SKIP_KEYS = new Set([
  'type', 'name', 'cantidad', 'quantity', 'productcost', 'productCost',
  'inventoryitemid', 'inventoryitemsku', 'requestedsku', 'id',
]);

const GENERIC_PRODUCT_NAMES = new Set([
  'parche', 'parches', 'patch', 'patches', 'producto', 'product', 'combo', 'mix',
]);

export function normalizeProductName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detailLineLabel(item: Record<string, unknown>): string {
  const base = String(item.type || item.name || 'Producto').trim() || 'Producto';
  const extras: string[] = [];
  const seen = new Set([normalizeProductName(base)]);

  const pushExtra = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 40) return;
    const normalized = normalizeProductName(trimmed);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    extras.push(trimmed);
  };

  pushExtra(item.color);
  pushExtra(item.tamano);
  pushExtra(item.sabor);
  pushExtra(item.variant);
  pushExtra(item.variante);
  pushExtra(item.flavor);

  for (const [key, value] of Object.entries(item)) {
    if (DETAIL_SKIP_KEYS.has(key) || DETAIL_SKIP_KEYS.has(key.toLowerCase())) continue;
    pushExtra(value);
  }

  return extras.length > 0 ? `${base} ${extras.join(' ')}` : base;
}

function parseProductDetailsPayload(raw: string): unknown {
  try {
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return raw;
  }
}

function looksLikeProductPart(part: string): boolean {
  const trimmed = part.trim();
  if (!trimmed || trimmed.length > 48) return false;
  if (/\d{5,}/.test(trimmed)) return false;
  return true;
}

function parseQtyName(part: string): { rawName: string; qty: number; explicitQty: boolean } {
  let name = part.replace(/^[-*•]\s*/, '').trim();
  const trailing = name.match(/^(.*?)(?:\s*[xX×*]\s*(\d+)|\s+\(\s*(\d+)\s*\))\s*$/);
  if (trailing?.[1]?.trim()) {
    return {
      rawName: trailing[1].trim(),
      qty: Math.max(1, Number(trailing[2] || trailing[3]) || 1),
      explicitQty: true,
    };
  }
  const leading = name.match(/^(\d+)\s+(.+)$/);
  if (leading?.[2]?.trim()) {
    return {
      rawName: leading[2].trim(),
      qty: Math.max(1, Number(leading[1]) || 1),
      explicitQty: true,
    };
  }
  return { rawName: name || 'Producto', qty: 1, explicitQty: false };
}

function splitCompoundParts(chunk: string): string[] {
  const plusParts = chunk.split(/\s+\+\s+|\s+&\s+/).map((part) => part.trim()).filter(Boolean);
  if (plusParts.length >= 2 && plusParts.every(looksLikeProductPart)) return plusParts;

  const andParts = chunk.split(/\s+(?:y|and)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (andParts.length >= 2 && andParts.length <= 6 && andParts.every(looksLikeProductPart)) {
    return andParts;
  }
  return [chunk];
}

function splitProductText(value: string): string[] {
  const raw = value.trim();
  if (!raw) return [];

  const primary = raw
    .split(/\r?\n|;/g)
    .map((part) => part.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const chunk of primary) {
    for (const piece of splitCompoundParts(chunk)) {
      if (!/,/.test(piece)) {
        parts.push(piece);
        continue;
      }
      const segments = piece.split(',').map((part) => part.trim()).filter(Boolean);
      const canSplit = segments.length >= 2 && segments.every((segment) => segment.length > 0 && segment.length <= 48);
      if (canSplit) parts.push(...segments);
      else parts.push(piece);
    }
  }
  return parts;
}

function linesFromProductText(
  product: string,
  quantity: number | null | undefined,
): Array<{ rawName: string; qty: number }> {
  const parts = splitProductText(product);
  if (parts.length <= 1) {
    const parsed = parseQtyName(parts[0] || product);
    return [{
      rawName: parsed.rawName,
      qty: parsed.explicitQty ? parsed.qty : Math.max(1, Number(quantity) || parsed.qty),
    }];
  }

  const parsed = parts.map(parseQtyName);
  const fallbackQty = Math.max(1, Number(quantity) || 1);
  const anyExplicit = parsed.some((part) => part.explicitQty);
  if (!anyExplicit && fallbackQty === parsed.length) {
    return parsed.map((part) => ({ rawName: part.rawName, qty: 1 }));
  }
  if (!anyExplicit && fallbackQty > parsed.length && fallbackQty % parsed.length === 0) {
    const each = fallbackQty / parsed.length;
    return parsed.map((part) => ({ rawName: part.rawName, qty: each }));
  }
  return parsed.map((part) => ({ rawName: part.rawName, qty: part.qty }));
}

export function extractOrderLines(order: {
  product?: string | null;
  quantity?: number | null;
  productDetails?: string | null;
}): Array<{ rawName: string; qty: number }> {
  if (order.productDetails) {
    const details = parseProductDetailsPayload(order.productDetails);
    if (Array.isArray(details) && details.length > 0) {
      const lines = details
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          rawName: detailLineLabel(item),
          qty: Math.max(1, Number(item.cantidad ?? item.quantity ?? 1) || 1),
        }))
        .filter((line) => line.rawName);
      if (lines.length > 0) return lines;
    }
    if (typeof details === 'string' && details.trim()) {
      return linesFromProductText(details, order.quantity);
    }
  }

  const product = (order.product || '').trim();
  if (!product) {
    return [{ rawName: 'Producto', qty: Math.max(1, Number(order.quantity) || 1) }];
  }
  return linesFromProductText(product, order.quantity);
}

function nameTokens(value: string): string[] {
  return normalizeProductName(value).split(' ').filter(Boolean);
}

export function resolveSkuFromMap(
  rawName: string,
  aliasMap: Map<string, { sku: string; displayName: string }>,
): { sku: string; displayName: string } | null {
  const normalized = normalizeProductName(rawName);
  if (!normalized) return null;

  const exact = aliasMap.get(normalized);
  if (exact) return exact;

  if (/[+,]/.test(rawName) || /\s(?:y|and|&)\s/i.test(rawName)) return null;

  const tokens = nameTokens(rawName);
  if (tokens.length === 0) return null;

  const hits: Array<{ sku: string; displayName: string }> = [];
  for (const [alias, value] of aliasMap.entries()) {
    if (!alias || alias.length < 3) continue;
    const aliasTokens = nameTokens(alias);
    if (aliasTokens.length === 0) continue;

    const nameContainsAlias = aliasTokens.every((token) => tokens.includes(token));
    const aliasContainsName = tokens.every((token) => (
      aliasTokens.includes(token)
      || (token.length >= 4 && aliasTokens.some((aliasToken) => aliasToken.startsWith(token)))
    ));
    if (!nameContainsAlias && !aliasContainsName) continue;
    if (!hits.some((hit) => hit.sku === value.sku)) {
      hits.push({ sku: value.sku, displayName: value.displayName });
    }
  }

  return hits.length === 1 ? hits[0] : null;
}

export function buildAliasMapFromRows(
  aliases: Array<{ sku: string; aliasNormalized?: string; alias_normalized?: string; displayName?: string | null; display_name?: string | null }>,
  stock: Array<{ sku: string; displayName: string }>,
): Map<string, { sku: string; displayName: string }> {
  const displayBySku = new Map(stock.map((s) => [s.sku, s.displayName]));
  const map = new Map<string, { sku: string; displayName: string }>();
  for (const row of aliases) {
    const key = row.aliasNormalized || row.alias_normalized || '';
    if (!key) continue;
    map.set(key, {
      sku: row.sku,
      displayName: row.displayName || row.display_name || displayBySku.get(row.sku) || row.sku,
    });
  }
  for (const row of stock) {
    map.set(normalizeProductName(row.displayName), { sku: row.sku, displayName: row.displayName });
    map.set(normalizeProductName(row.sku), { sku: row.sku, displayName: row.displayName });
  }
  return map;
}

export function orderContainsProductLabel(
  order: { product?: string | null; quantity?: number | null; productDetails?: string | null },
  rawName: string,
): boolean {
  const target = normalizeProductName(rawName);
  if (!target) return false;
  return extractOrderLines(order).some((line) => normalizeProductName(line.rawName) === target);
}

export function mapOrderLinesLocal(
  order: { product?: string | null; quantity?: number | null; productDetails?: string | null },
  aliasMap: Map<string, { sku: string; displayName: string }>,
): RetiroOrderLine[] {
  return extractOrderLines(order).map((line) => {
    const resolved = resolveSkuFromMap(line.rawName, aliasMap);
    return {
      rawName: line.rawName,
      qty: line.qty,
      sku: resolved?.sku ?? null,
      displayName: resolved?.displayName ?? null,
    };
  });
}

export function isGenericRetiroProductName(rawName: string): boolean {
  return GENERIC_PRODUCT_NAMES.has(normalizeProductName(rawName));
}

export function shouldPersistGlobalAlias(rawName: string): boolean {
  return !isGenericRetiroProductName(rawName);
}

function duplicateGenericCount(line: RetiroOrderLine, allLines: RetiroOrderLine[]): number {
  const normalized = normalizeProductName(line.rawName);
  return allLines.filter((candidate) => normalizeProductName(candidate.rawName) === normalized).length;
}

export function shouldExplodeRetiroLine(line: RetiroOrderLine): boolean {
  if (line.qty <= 1 || line.qty > 20) return false;
  return !line.sku || isGenericRetiroProductName(line.rawName);
}

export function linesNeedIndependentSlots(lines: RetiroOrderLine[]): boolean {
  return lines.some((line) => (
    shouldExplodeRetiroLine(line)
    || shouldClearSharedAlias(line, lines)
  ));
}

function shouldClearSharedAlias(line: RetiroOrderLine, allLines: RetiroOrderLine[]): boolean {
  if (!isGenericRetiroProductName(line.rawName)) return false;
  return line.qty > 1 || duplicateGenericCount(line, allLines) > 1;
}

export function buildMappingSlots(
  lines: RetiroOrderLine[],
  allocations: RetiroAllocationRow[] = [],
): RetiroMappingSlot[] {
  const bySlot = new Map(allocations.map((row) => [row.slotKey, row]));
  const slots: RetiroMappingSlot[] = [];

  lines.forEach((line, lineIndex) => {
    const hasSplitAlloc = allocations.some((row) => {
      const [linePart, unitPart] = row.slotKey.split(':');
      return unitPart !== undefined && Number(linePart) === lineIndex;
    });
    const explode = hasSplitAlloc || shouldExplodeRetiroLine(line);
    const clearAlias = explode || shouldClearSharedAlias(line, lines);
    const count = explode ? line.qty : 1;
    const unitQty = explode ? 1 : line.qty;

    for (let i = 0; i < count; i += 1) {
      const slotKey = explode ? `${lineIndex}:${i}` : String(lineIndex);
      const saved = bySlot.get(slotKey);
      slots.push({
        slotKey,
        rawName: line.rawName,
        qty: saved?.qty || unitQty,
        sku: saved?.sku ?? (clearAlias ? null : line.sku),
        displayName: saved?.displayName ?? (clearAlias ? null : line.displayName),
        unitHint: explode && count > 1 ? `unidad ${i + 1} de ${count}` : null,
      });
    }
  });

  return slots;
}
