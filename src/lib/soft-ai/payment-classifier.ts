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

const PAY_NOUN = String.raw`(sinpe|pago|plata|dinero|transferencia|dep[oó]sito|comprobante|monto)`
const W = String.raw`(?:\s+[\p{L}\p{N}₡.,]+){0,4}?\s+`
const near = (a: string, b: string) => `(?:${a}${W}${b}|${b}${W}${a})`
/**
 * Claims, receipts, refunds and disputes — with or without "ya", as a question or not (INT-76, 2026-10-09):
 * "¿ya te llegó mi sinpe?", "hice el sinpe, ¿cuándo sale?", "hice un sinpe por error, ¿me lo devuelven?".
 * Checked FIRST; any hit stays with a person.
 */
const CLAIM_CUE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(` +
    [
      near(String.raw`(hice|mand[eé]|envi[eé]|pas[eé]|transfer[ií]|deposit[eé]|acabo\s+de\s+(pagar|hacer|mandar|enviar|pasar|transferir|depositar|cancelar))`, PAY_NOUN),
      String.raw`pagu[eé]|deposit[eé]|transfer[ií]|^\s*¿?\s*pagad[oa]\s*[?!.✅👍]*\s*$`,
      // Costa Rica: "cancelar" = to pay ("ya cancelé", "está cancelado"). "Quiero cancelar el pedido" also reaches
      // a person — a safe failure (INT-82).
      String.raw`cancel[eé]|acabo\s+de\s+cancelar|(ya\s+)?(est[aá]|qued[oó])\s+cancelad[oa]|(pedido|monto|saldo|pago)\s+(ya\s+)?(est[aá]\s+|qued[oó]\s+)?cancelad[oa]|ya\s+cancelad[oa]`,
      // An amount the customer says was received / arrived: "¿Recibiste los ₡14900?" (INT-82).
      near(String.raw`(lleg[oó]|llegaron|recibi(eron|ste|mos|ó|o)|recibieron)`, String.raw`((los|mis|esos|estos|sus)\s+(₡\s?[\d.,]+|[\d.,]+\s*(colones|rojos|mil)))`),
      String.raw`sinpe\s+(hecho|listo|enviado|realizado|mandado)`,
      near(String.raw`(lleg[oó]|recibi(eron|ste|mos|ó|o)|reflej\p{L}*|aparec\p{L}*|cay[oó]|entr[oó])`, PAY_NOUN),
      String.raw`(tienen|vieron|viste|vio|ven)\s+(mi|el|la|los)\s+${PAY_NOUN}`,
      // Refund / wrong-payment / overcharge only next to money words: "¿puedo devolverlo si no me queda?",
      // "¿cuánto me cobran por el envío?", "te escribí por error" are ordinary questions (Verifier 2026-10-09).
      near(String.raw`por\s+error`, String.raw`(${PAY_NOUN.slice(1, -1)}|plata|dinero)`),
      // Past-tense charges are complaints ("me cobró ₡2000 y era gratis"); present "¿me cobran…?" is a question.
      String.raw`me\s+cobr(aron|[oó])|me\s+(han|hab[ií]an)\s+(cobrado|rebajado|descontado)|reembols\p{L}*|reintegr\p{L}*|no\s+reconozco`,
      // Charge nouns with an overcharge word: "hay un cargo de más", "el cobro salió doble", "doble cargo" (INT-81).
      near(String.raw`(cargos?|cobros?|rebajos?|d[eé]bitos?)`, String.raw`(de\s+m[aá]s|dobles?|dos\s+veces|duplicad\p{L}*)`),
      String.raw`(doble|dos)\s+(cargos?|cobros?)`,
      // "me rebajaron dos veces de la tarjeta", "me descontaron de más de la cuenta": a charge complaint, never info.
      near(String.raw`(cobraron|cobr[oó]|rebajaron|rebaj[oó]|descontaron|descont[oó]|debitaron|debit[oó])`, String.raw`(tarjeta|cuenta|${PAY_NOUN.slice(1, -1)}|plata|dinero|doble|dos\s+veces|de\s+m[aá]s)`),
    ].join('|') +
    String.raw`)(?![\p{L}\p{N}_])`,
  'iu',
)

/** Only explicit "how / can I pay" questions are answered by the agent (never a bare "?"). */
const PAYMENT_QUESTION_RE = new RegExp(
  String.raw`(?<![\p{L}])(` +
    String.raw`(puedo|se\s+puede|pued[eo]n|aceptan|hay\s+que|tengo\s+que|debo)(\s+\p{L}+){0,2}\s+(pagar|pago|pagarles|pagarte)` +
    String.raw`|(c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]\s+formas?\s+de)(\s+\p{L}+){0,2}\s+(pago|pagar|se\s+paga|pagos)` +
    String.raw`|(reciben|tienen|aceptan|usan|trabajan\s+con)\s+(sinpe|transferencias?|tarjetas?|efectivo)` +
    String.raw`)(?![\p{L}])`,
  'iu',
)

/** Refund wording (INT-81): goes to a person unless it is a plain return-policy question. */
const REFUND_RE = /(?<![\p{L}])(devol\p{L}*|devuelv\p{L}*|regres(en|e|ar|ame|enme)\s+(la\s+plata|el\s+dinero|mi\s+plata|mi\s+dinero|lo\s+que\s+(di|pagu[eé])))/iu
// A greeting may come first ("Hola, ¿puedo devolverlo si no me queda?"); only the FIRST sentence is the question.
const RETURN_POLICY_QUESTION_RE =
  /^\s*((hola|buenas|buenos\s+d[ií]as|buenas\s+(tardes|noches)|disculpe|una\s+consulta|consulta)[\s,.!]*)?¿?\s*(puedo|se\s+puede|pueden|c[oó]mo|hacen|aceptan|tienen|hay)(?![\p{L}])[^.!?\n]*(devol\p{L}*|devuelv\p{L}*|cambi\p{L}*)/iu
const MONEY_WORD_RE = /plata|dinero|pago|sinpe|reembols|₡|lo\s+que\s+(di|pagu[eé])/iu
/** Returning something TO the customer = money back: never a return-policy question. */
const REFUND_TO_ME_RE = /(?<![\p{L}])(devolverme|devu[eé]lvanme|devu[eé]lvame|me\s+devuelv\p{L}*|me\s+lo\s+devuelv\p{L}*)/iu

/** A plain return-policy question: nothing about money, and no refund wording after that first question. */
function isReturnPolicyQuestion(value: string): boolean {
  const m = RETURN_POLICY_QUESTION_RE.exec(value)
  if (!m) return false
  const rest = value.slice(m.index + m[0].length).replace(/^[^?.!\n]*[?.!\n]?/, '')
  return !MONEY_WORD_RE.test(value) && !REFUND_TO_ME_RE.test(value) && !REFUND_RE.test(rest)
}

export function hasPaymentClaimCue(text: string): boolean {
  const value = text || ''
  return CLAIM_CUE_RE.test(value) || (REFUND_RE.test(value) && !isReturnPolicyQuestion(value))
}

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
  if (PROOF_CUE_RE.test(value) || hasPaymentClaimCue(value) || CONFIRM_CUE_RE.test(value) || RISK_CUE_RE.test(value)) {
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
  // An explicit "how / can I pay" question ("¿puedo pagar en efectivo?", "¿cuándo se paga?") is answered by the agent
  // under the fixed payment rules; everything else with payment words stays with a person (fail closed).
  if (PAYMENT_RE.test(value) && PAYMENT_QUESTION_RE.test(value)) {
    return 'non_payment'
  }
  if (PAYMENT_RE.test(value)) {
    return 'payment_proof_or_risk'
  }
  return 'non_payment'
}
