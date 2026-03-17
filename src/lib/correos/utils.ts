/**
 * Builds a human-readable description for a shipping guía that includes
 * product names with their quantities.
 *
 * Priority:
 *   1. productDetails JSON (per-item breakdown with individual quantities)
 *   2. product + quantity fields (flat summary)
 *   3. comments or fallback "Paquete"
 */
export function buildGuiaDescription(order: {
  product?: string | null;
  quantity?: number | null;
  productDetails?: string | null;
  comments?: string | null;
}): string {
  if (order.productDetails) {
    try {
      const details = JSON.parse(order.productDetails);
      if (Array.isArray(details) && details.length > 0) {
        const parts = details.map((item: { type?: string; cantidad?: number }) => {
          const name = item.type || 'Producto';
          const qty = item.cantidad || 1;
          return qty > 1 ? `${name} (x${qty})` : name;
        });
        return parts.join(', ');
      }
    } catch {
      // productDetails isn't valid JSON — fall through
    }
  }

  const productName = order.product || order.comments || 'Paquete';
  const qty = order.quantity || 1;

  if (qty > 1) {
    return `${productName} (x${qty})`;
  }

  return productName;
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
