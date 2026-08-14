export type RetiroOrderLine = {
  rawName: string;
  qty: number;
  sku: string | null;
  displayName: string | null;
};

export function normalizeProductName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractOrderLines(order: {
  product?: string | null;
  quantity?: number | null;
  productDetails?: string | null;
}): Array<{ rawName: string; qty: number }> {
  if (order.productDetails) {
    try {
      const details = JSON.parse(order.productDetails);
      if (Array.isArray(details) && details.length > 0) {
        return details
          .map((item: { type?: string; name?: string; cantidad?: number; quantity?: number }) => ({
            rawName: String(item.type || item.name || 'Producto').trim() || 'Producto',
            qty: Math.max(1, Number(item.cantidad ?? item.quantity ?? 1) || 1),
          }))
          .filter((line) => line.rawName);
      }
    } catch {
      // fall through
    }
  }

  const product = (order.product || '').trim();
  if (!product) {
    return [{ rawName: 'Producto', qty: Math.max(1, Number(order.quantity) || 1) }];
  }

  // Prefer whole product label + order.quantity. Embedded "x2" is informational;
  // productDetails is the authoritative multi-line source when present.
  return [{
    rawName: product,
    qty: Math.max(1, Number(order.quantity) || 1),
  }];
}

export function resolveSkuFromMap(
  rawName: string,
  aliasMap: Map<string, { sku: string; displayName: string }>,
): { sku: string; displayName: string } | null {
  const normalized = normalizeProductName(rawName);
  if (!normalized) return null;

  const exact = aliasMap.get(normalized);
  if (exact) return exact;

  let best: { sku: string; displayName: string; score: number } | null = null;
  for (const [alias, value] of aliasMap.entries()) {
    if (!alias || alias.length < 3) continue;
    if (normalized.includes(alias) || alias.includes(normalized)) {
      const score = alias.length;
      if (!best || score > best.score) {
        best = { ...value, score };
      }
    }
  }
  return best ? { sku: best.sku, displayName: best.displayName } : null;
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
