import { createHash, timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison via SHA-256 digests (equal length).
 * Avoids early-exit leaks from `===` on secrets.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digA = createHash('sha256').update(a, 'utf8').digest();
  const digB = createHash('sha256').update(b, 'utf8').digest();
  return digA.length === digB.length && timingSafeEqual(digA, digB);
}

/**
 * Neutralize CSV/Spreadsheet formula injection for exported cell values.
 * Lives in ./csv-safe (client-safe) so browser-side exporters use the same rule.
 */
export { neutralizeCsvFormula } from './csv-safe';

/** Headers for authenticated PII downloads (exports, PDFs, CSV). */
export const PII_NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};
