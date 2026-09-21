/**
 * Soft Agent Layer output provenance validator (pre-send gate 9).
 * A2: monetary claims require a cited search_inventory call (not knowledge docs).
 */

export type OutputValidationResult = {
  ok: boolean
  needsHuman: boolean
  reasons: string[]
}

const MONEY_RE = /[₡$]\s?\d|\d[\d.,]*\s*(colones|crc|usd)/i
const CREATED_CLAIM_RE = /ya\s+(cre[eé]|registr[eé]|arm[eé])|pedido\s+creado|acabo\s+de\s+crear/i
const UNIT_COST_RE = /unitCost|costo\s+unitario|precio\s+de\s+costo/i

export function validateAgentOutput(input: {
  text: string
  citedToolNames: string[]
  /** Optional: successful inventory tool results for amount matching. */
  inventoryPrices?: number[]
}): OutputValidationResult {
  const reasons: string[] = []
  const text = input.text || ''
  const cited = new Set(input.citedToolNames)

  if (UNIT_COST_RE.test(text)) {
    reasons.push('unit_cost_leak')
  }
  if (CREATED_CLAIM_RE.test(text)) {
    reasons.push('write_claim')
  }
  // Knowledge / FAQ / order status never authorize a ₡ claim — inventory only.
  if (MONEY_RE.test(text) && !cited.has('search_inventory')) {
    reasons.push('unsourced_money')
  }

  if (
    MONEY_RE.test(text) &&
    cited.has('search_inventory') &&
    Array.isArray(input.inventoryPrices) &&
    input.inventoryPrices.length > 0
  ) {
    const amounts = [...text.matchAll(/[₡$]?\s?(\d[\d.,]*)/g)]
      .map((m) => Number(String(m[1]).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')))
      .filter((n) => Number.isFinite(n) && n > 0)
    const allowed = new Set(
      input.inventoryPrices.map((p) => Math.round(p)),
    )
    for (const amt of amounts) {
      const rounded = Math.round(amt)
      // Ignore tiny numbers that aren't likely prices (e.g. quantities 1–9)
      if (rounded < 100) continue
      if (![...allowed].some((a) => Math.abs(a - rounded) <= 1)) {
        reasons.push('money_mismatch_inventory')
        break
      }
    }
  }

  const needsHuman = reasons.length > 0
  return { ok: !needsHuman, needsHuman, reasons }
}
