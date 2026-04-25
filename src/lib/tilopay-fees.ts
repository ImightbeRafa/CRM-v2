export const TILOPAY_FEE_RATES = {
  commissionRate: 548.25 / 12900,
  transactionCostRate: 161.70 / 12900,
  serviceTaxRate: 0.13,
} as const;

export interface TilopayFeeBreakdown {
  isTilopay: boolean;
  commission: number;
  transactionCost: number;
  serviceTax: number;
  total: number;
  commissionRate: number;
  transactionCostRate: number;
  serviceTaxRate: number;
}

type TilopayOrderSource = {
  comments?: unknown;
  customFields?: unknown;
  salesChannel?: unknown;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isTilopayOrder(order: TilopayOrderSource): boolean {
  const comments = normalize(order.comments);
  const salesChannel = normalize(order.salesChannel);
  const customFields = normalize(stringify(order.customFields));
  const haystack = `${comments} ${salesChannel} ${customFields}`;

  if (haystack.includes('tilopay')) return true;

  return (
    comments.includes('detalles de la transaccion') &&
    comments.includes('total debitado') &&
    comments.includes('servicios')
  );
}

export function calculateTilopayFees(total: unknown, shouldCharge: boolean): TilopayFeeBreakdown {
  const amount = Number(total);
  if (!shouldCharge || !Number.isFinite(amount) || amount <= 0) {
    return {
      isTilopay: false,
      commission: 0,
      transactionCost: 0,
      serviceTax: 0,
      total: 0,
      ...TILOPAY_FEE_RATES,
    };
  }

  const commission = roundCurrency(amount * TILOPAY_FEE_RATES.commissionRate);
  const transactionCost = roundCurrency(amount * TILOPAY_FEE_RATES.transactionCostRate);
  const serviceTax = roundCurrency((commission + transactionCost) * TILOPAY_FEE_RATES.serviceTaxRate);

  return {
    isTilopay: true,
    commission,
    transactionCost,
    serviceTax,
    total: roundCurrency(commission + transactionCost + serviceTax),
    ...TILOPAY_FEE_RATES,
  };
}
