/**
 * Soft Agent Layer output provenance validator (pre-send gate 9).
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
  if (MONEY_RE.test(text) && !cited.has('search_inventory') && !cited.has('get_order_status')) {
    reasons.push('unsourced_money')
  }

  const needsHuman = reasons.length > 0
  return { ok: !needsHuman, needsHuman, reasons }
}
