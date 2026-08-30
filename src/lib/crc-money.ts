/**
 * Costa Rican colón parsing.
 * Thousands may use `.` or `,` (`₡3.000` / `₡3,000` → 3000).
 * Decimal separators are a comma or a remaining dot after thousands are stripped.
 */

export class CrcMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrcMoneyError';
  }
}

const FREE_TOKENS = new Set(['gratis', 'free', '0', '0.0', '0,00', '0.00']);

function stripCurrencyNoise(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');
}

function normalizeNumericText(raw: string): string {
  return stripCurrencyNoise(raw)
    .replace(/[.,](?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
}

export function parseCrcAmount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  }
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (FREE_TOKENS.has(raw.toLowerCase())) return 0;
  const numericText = normalizeNumericText(raw);
  if (!numericText || !/\d/.test(numericText)) return undefined;
  const parsed = Number(numericText);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

export function parseCrcMoneyRequired(value: unknown, fieldLabel: string): number {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) {
    throw new CrcMoneyError(`${fieldLabel} es requerido`);
  }
  const amount = parseCrcAmount(value);
  if (amount === undefined) {
    throw new CrcMoneyError(
      `${fieldLabel} no es un monto válido (${raw}). Use ₡3.000 o ₡3000, no un punto decimal ambiguo.`,
    );
  }
  return amount;
}

export function parseCrcProductAmount(value: unknown, fieldLabel: string): number {
  const amount = parseCrcMoneyRequired(value, fieldLabel);
  if (amount <= 0) {
    throw new CrcMoneyError(`${fieldLabel} debe ser mayor a ₡0`);
  }
  return amount;
}

export function parseCrcShippingAmount(value: unknown, fieldLabel: string): number {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 0;
  }
  return parseCrcMoneyRequired(value, fieldLabel);
}
