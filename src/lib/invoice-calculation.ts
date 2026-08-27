export const IVA_RATE = 0.13;

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
/** Betsy orders store a gross amount. V2 invoices expose the included IVA
 * without adding it to the amount the customer already agreed to pay. */
export function calculateIncludedIva(grossInput: number, discountInput = 0) {
  const grossBeforeDiscount = Math.max(0, Number(grossInput) || 0);
  const discount = Math.max(0, Number(discountInput) || 0);
  const total = money(Math.max(0, grossBeforeDiscount - discount));
  const subtotal = money(total / (1 + IVA_RATE));
  const tax = money(total - subtotal);
  return { subtotal, tax, discount: money(discount), total, calculationVersion: 2 as const };
}

export function invoiceGrossFromItems(items: Array<{ total?: unknown; quantity?: unknown; unitPrice?: unknown }>) {
  return money(items.reduce((sum, item) => {
    const explicit = Number(item.total);
    if (Number.isFinite(explicit)) return sum + explicit;
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    return sum + quantity * unitPrice;
  }, 0));
}
