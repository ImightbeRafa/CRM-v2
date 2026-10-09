/**
 * Single deterministic payment classifier for the Soft Agent Layer.
 * Proof / confirmation / risk and ambiguous payment text stay human.
 * Information questions are payment_info_safe only when the cue is clear.
 */

export type PaymentClassification = 'non_payment' | 'payment_info_safe' | 'payment_proof_or_risk'

const PROOF_CUE_RE =
  // "ya te/les/lo pagué", "listo, ya lo pagué", "te mandé el sinpe" (accent-safe start: JS \b misses after á/é).
  /(?<![\p{L}\p{N}_])(ya\s+((le|te|les|lo|la)\s+)?(pagu[eé]|hice|mand[eé]|transfer[ií]|deposit[eé])|comprobante|adjunto|captura|pantallazo|(le|te|les)\s+(envi[eé]|mand[eé])\s+(el\s+(sinpe|pago|comprobante)|la\s+plata|el\s+dinero)|pago\s+(realizado|hecho|listo)|listo\s+el\s+(pago|sinpe)|(ya\s+)?(est[aá]|qued[oó])\s+pagad[oa]|^\s*pagad[oa]\s*[!.✅👍]*\s*$|ref(?:erencia)?\s*\d)/iu

/** Unicode-aware: JS \\b treats á/ó as non-word, so "llegó" and "confirman" would miss. */
const CONFIRM_CUE_RE =
  /(?:^|[^\p{L}\p{N}_])((?:me\s+)?confirm[aáeé]\p{L}*|ya\s+(?:les\s+)?lleg[oó]\p{L}*|revisen)/iu

const RISK_CUE_RE =
  /\b(reembolso|devoluci[oó]n\s+del\s+dinero|me\s+cobraron|doble\s+cobro|reclamo|disputa|fraude)\b/i

const INFO_CUE_RE =
  /\b(c[oó]mo\s+(pago|puedo\s+pagar|se\s+paga)|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|aceptan|n[uú]mero\s+(de\s+)?sinpe|sinpe\s+m[oó]vil|tarjeta|cuenta\s+(bancaria|iban)|transferencia)\b/i

const COD_QUESTION_RE =
  /(?<![\p{L}])(contra\s?entrega|pag(o|ar)\s+(al\s+recibir|cuando\s+(lo\s+|la\s+|me\s+)?(recib|lleg))|pago\s+en\s+efectivo\s+al)/iu

/** A question about paying (not a claim of having paid). */
const PAYMENT_QUESTION_RE =
  /\?|(?<![\p{L}])(puedo|se\s+puede|pued[eo]n|aceptan|hay\s+que|tengo\s+que|c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]\s+formas?)(?![\p{L}])/iu

/** Legacy broad net. Ambiguous hits default to human. */
const PAYMENT_RE =
  /\b(sinpe|transferencia|pago|pagar|comprobante|ib[aá]n|cuenta\s*banc|deposit[oa]|efectivo\s*contra)\b/i

export function hasPaymentProofCue(text: string): boolean {
  return PROOF_CUE_RE.test(text || '')
}

export function hasPaymentRiskCue(text: string): boolean {
  return RISK_CUE_RE.test(text || '')
}

export function classifyPaymentText(text: string): PaymentClassification {
  const value = text || ''
  if (PROOF_CUE_RE.test(value) || CONFIRM_CUE_RE.test(value) || RISK_CUE_RE.test(value)) {
    return 'payment_proof_or_risk'
  }
  // Contra entrega / "¿puedo pagar cuando lo recibo?" is a sales question (zone coverage), not payment data:
  // the agent answers it (Rafael 2026-10-09 — it used to hand off with "ya lo reviso").
  if (COD_QUESTION_RE.test(value)) {
    return 'non_payment'
  }
  if (INFO_CUE_RE.test(value)) {
    return 'payment_info_safe'
  }
  // Any other payment-word QUESTION ("¿puedo pagar en efectivo?", "¿se paga antes?") is answered by the agent
  // under the fixed payment rules; only statements (possible proof / claims) stay with a person.
  if (PAYMENT_RE.test(value) && PAYMENT_QUESTION_RE.test(value)) {
    return 'non_payment'
  }
  if (PAYMENT_RE.test(value)) {
    return 'payment_proof_or_risk'
  }
  return 'non_payment'
}
