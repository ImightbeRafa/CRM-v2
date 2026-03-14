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
