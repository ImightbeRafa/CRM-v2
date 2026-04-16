/**
 * Correos WS OBSERVACIONES field limit (from official documentation).
 */
const MAX_OBSERVACIONES = 200;

/**
 * Builds a human-readable description for a shipping guía that includes
 * product names with their quantities, capped at {@link MAX_OBSERVACIONES}
 * characters so the printed label never truncates quantity information.
 *
 * Priority:
 *   1. productDetails JSON (per-item breakdown with individual quantities)
 *   2. product + quantity fields (flat summary)
 *   3. comments or fallback "Paquete"
 *
 * When the full description exceeds the limit, product names are
 * progressively shortened while quantity suffixes are always preserved.
 */
export function buildGuiaDescription(order: {
  product?: string | null;
  quantity?: number | null;
  productDetails?: string | null;
  comments?: string | null;
}): string {
  // 1. Collect items with name + qty
  let items: { name: string; qty: number }[] = [];

  if (order.productDetails) {
    try {
      const details = JSON.parse(order.productDetails);
      if (Array.isArray(details) && details.length > 0) {
        items = details.map((item: { type?: string; cantidad?: number }) => ({
          name: item.type || 'Producto',
          qty: item.cantidad || 1,
        }));
      }
    } catch {
      // productDetails isn't valid JSON — fall through
    }
  }

  if (items.length === 0) {
    items = [{
      name: order.product || order.comments || 'Paquete',
      qty: order.quantity || 1,
    }];
  }

  // 2. Helper: format a single item
  const fmt = (name: string, qty: number) =>
    qty > 1 ? `${name} (x${qty})` : name;

  // 3. Try full-length first
  const full = items.map(i => fmt(i.name, i.qty)).join(', ');
  if (full.length <= MAX_OBSERVACIONES) {
    return full;
  }

  // 4. Abbreviate — calculate fixed overhead per item (qty suffix + separators)
  const SEPARATOR = ', ';
  const separatorTotal = Math.max(0, items.length - 1) * SEPARATOR.length;
  const qtySuffixes = items.map(i => i.qty > 1 ? ` (x${i.qty})` : '');
  const fixedOverhead = separatorTotal + qtySuffixes.reduce((sum, s) => sum + s.length, 0);

  // Space left for all product names combined
  const availableForNames = MAX_OBSERVACIONES - fixedOverhead;
  const maxPerName = Math.max(8, Math.floor(availableForNames / items.length));

  const abbreviated = items.map((item, idx) => {
    let name = item.name;
    if (name.length > maxPerName) {
      name = name.slice(0, maxPerName - 2).trimEnd() + '..';
    }
    return fmt(name, item.qty) + (idx < items.length - 1 ? SEPARATOR : '');
  }).join('');

  // 5. Final safety — hard-truncate if still over limit
  if (abbreviated.length > MAX_OBSERVACIONES) {
    return abbreviated.slice(0, MAX_OBSERVACIONES - 2) + '..';
  }

  return abbreviated;
}

/**
 * Composes a full address string including Provincia, Cantón, and Distrito
 * for the Correos DEST_DIRECCION field (max 500 chars).
 *
 * Falls back gracefully when location parts are missing.
 */
export function buildFullAddress(order: {
  province?: string | null;
  canton?: string | null;
  district?: string | null;
  address?: string | null;
}): string {
  const locationParts = [order.province, order.canton, order.district].filter(Boolean);
  const streetAddress = order.address || '';

  if (locationParts.length > 0 && streetAddress) {
    return `${locationParts.join(', ')}. ${streetAddress}`;
  }
  if (locationParts.length > 0) {
    return locationParts.join(', ');
  }
  return streetAddress || 'Sin dirección';
}
