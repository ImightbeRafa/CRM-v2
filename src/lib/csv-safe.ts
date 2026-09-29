/**
 * Spreadsheet formula-injection guard, safe for client and server (no Node imports).
 * Customer-typed text such as `=HYPERLINK(...)` must never run when an export is opened in
 * Excel / Sheets: values starting with a formula trigger get a leading apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r|＝＋－＠]/

export function neutralizeCsvFormula(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return FORMULA_START.test(str) ? `'${str}` : str
}

/** One CSV cell: numbers stay numbers (negative amounts are not formulas), text is neutralized and quoted. */
export function csvCell(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return `"${neutralizeCsvFormula(value).replace(/"/g, '""')}"`
}
