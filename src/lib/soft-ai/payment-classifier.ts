/**
 * Single deterministic payment classifier for the Soft Agent Layer.
 * Proof / confirmation / risk and ambiguous payment text stay human.
 * Information questions are payment_info_safe only when the cue is clear.
 */

export type PaymentClassification = 'non_payment' | 'payment_info_safe' | 'payment_proof_or_risk'

const PROOF_CUE_RE =
  /\b(ya\s+(le\s+)?(pagu[eé]|hice|mand[eé]|transfer[ií]|deposit[eé])|comprobante|adjunto|captura|pantallazo|le\s+(envi[eé]|mand[eé])\s+el\s+(sinpe|pago)|pago\s+(realizado|hecho|listo)|listo\s+el\s+(pago|sinpe)|ref(?:erencia)?\s*\d)/i

/** Unicode-aware: JS \\b treats á/ó as non-word, so "llegó" and "confirman" would miss. */
const CONFIRM_CUE_RE =
  /(?:^|[^\p{L}\p{N}_])((?:me\s+)?confirm[aáeé]\p{L}*|ya\s+(?:les\s+)?lleg[oó]\p{L}*|revisen)/iu

const RISK_CUE_RE =
  /\b(reembolso|devoluci[oó]n\s+del\s+dinero|me\s+cobraron|doble\s+cobro|reclamo|disputa|fraude)\b/i

const INFO_CUE_RE =
  /\b(c[oó]mo\s+(pago|puedo\s+pagar|se\s+paga)|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|aceptan|n[uú]mero\s+(de\s+)?sinpe|sinpe\s+m[oó]vil|tarjeta|cuenta\s+(bancaria|iban)|transferencia)\b/i

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
  if (INFO_CUE_RE.test(value)) {
    return 'payment_info_safe'
  }
  if (PAYMENT_RE.test(value)) {
    return 'payment_proof_or_risk'
  }
  return 'non_payment'
}
