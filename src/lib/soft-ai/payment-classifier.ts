/**
 * Single deterministic payment classifier for the Soft Agent Layer.
 * Proof / confirmation / risk and ambiguous payment text stay human.
 * Information questions are payment_info_safe only when the cue is clear.
 */

export type PaymentClassification = 'non_payment' | 'payment_info_safe' | 'payment_proof_or_risk'

const PROOF_CUE_RE =
  // "ya te/les/lo pagué", "listo, ya lo pagué", "te mandé el sinpe" (accent-safe start: JS \b misses after á/é).
  /(?<![\p{L}\p{N}_])(ya\s+((le|te|les|lo|la)\s+)?(pagu[eé]|hice|mand[eé]|transfer[ií]|deposit[eé])|comprobante|adjunto|captura|pantallazo|(le|te|les)\s+(envi[eé]|mand[eé])\s+(el\s+(sinpe|pago|comprobante)|la\s+plata|el\s+dinero)|pago\s+(realizado|hecho|listo)|listo\s+el\s+(pago|sinpe)|(ya\s+)?(est[aá]|qued[oó])\s+pagad[oa]|^\s*pagad[oa]\s*[!.✅👍]*\s*$|ref(?:erencia)?\s*\d)/iu

/**
 * Unicode-aware: JS \\b treats á/ó as non-word, so "llegó" and "confirman" would miss. Bare confirm / review verbs stay
 * payment cues ("Confirmame que lo recibieron", "Revisen porfa"): narrowing them let payment claims reach the model
 * (SecureDog INT-93, 2026-10-15 — restored to the INT-70/76 behaviour).
 */
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
 * "¿me confirmás el sinpe?", "revisen el comprobante", "confirmame si entró la plata": a payment claim. Without a
 * payment noun ("¿me confirmás la talla?", "confirmame el precio") it is a normal question for the agent (B5).
 */
const CONFIRM_PAYMENT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])` +
    near(String.raw`(confirm\p{L}*|revis\p{L}*)`, String.raw`(sinpe|pagos?|plata|dinero|transferencias?|dep[oó]sitos?|comprobantes?)`) +
    String.raw`(?![\p{L}\p{N}_])`,
  'iu',
)
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
      String.raw`(recibi(eron|ste|mos|ó|o)|lleg[oó]|llegaron)\s+(₡\s?[\d.,]+|[\d.,]+\s*(colones|rojos|mil))`,
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

/** "Le envié 15 mil", "Te mandé ₡20.000", "Envié 15000 hace un rato": a payment claim even with no payment word (MEDIA-15). */
const SENT_AMOUNT_CLAIM_RE =
  /(?<![\p{L}])(envi[eé]|mand[eé]|pas[eé]|deposit[eé]|transfer[ií]|pagu[eé]|hice)(?:\s+\p{L}+){0,2}?\s+(?:₡\s?\d|\d+(?:[.,\s]\d{3})*\s*(?:mil|k|colones|rojos)(?![\p{L}])|\d{4,})/iu

export function classifyPaymentText(text: string): PaymentClassification {
  const value = text || ''
  if (SENT_AMOUNT_CLAIM_RE.test(value)) return 'payment_proof_or_risk'
  if (
    PROOF_CUE_RE.test(value) ||
    hasPaymentClaimCue(value) ||
    CONFIRM_CUE_RE.test(value) ||
    CONFIRM_PAYMENT_RE.test(value) ||
    RISK_CUE_RE.test(value)
  ) {
    return 'payment_proof_or_risk'
  }
  // Contra entrega / "¿puedo pagar cuando lo recibo?" is a sales question (zone coverage), not payment data:
  // the agent answers it (Rafael 2026-10-09 — it used to hand off with "ya lo reviso").
  if (COD_QUESTION_RE.test(value)) {
    return 'non_payment'
  }
  // INT-115: "Transferencia realizada", "tarjeta aprobada", "Listo, transferencia", ✅ — a claim, not an info question.
  if (PAYMENT_COMPLETION_RE.test(value) && (INFO_CUE_RE.test(value) || PAYMENT_RE.test(value))) {
    return 'payment_proof_or_risk'
  }
  if (INFO_CUE_RE.test(value)) {
    return 'payment_info_safe'
  }
  // An explicit "how / can I pay" question ("¿puedo pagar en efectivo?", "¿cuándo se paga?") is answered by the agent
  // under the fixed payment rules; everything else with payment words stays with a person (fail closed).
  if (PAYMENT_RE.test(value) && PAYMENT_QUESTION_RE.test(value)) {
    return 'non_payment'
  }
  // B5 (Agentes IA 2.0), narrowed after SecureDog INT-93: ONLY an explicit list of info questions reaches the agent
  // ("¿el pago es por adelantado?", "¿con qué banco es el sinpe?", "¿aceptan tarjeta?") and never one that asks about
  // the state of a payment ("¿se acreditó el pago?", "¿mi sinpe es válido?"). Everything else stays with a person.
  if (PAYMENT_RE.test(value) && isPaymentInfoQuestion(value)) {
    return 'non_payment'
  }
  if (PAYMENT_RE.test(value)) {
    return 'payment_proof_or_risk'
  }
  return 'non_payment'
}

/** Plain info questions about HOW the store takes payment (explicit list — never a generic "question" heuristic). */
const PAYMENT_INFO_QUESTION_RE =
  /(adelantad|anticipad|con\s+qu[eé]\s+banco|qu[eé]\s+bancos?|a\s+qu[eé]\s+(n[uú]mero|cuenta)|aceptan\s+(tarjetas?|sinpe|transferencias?|efectivo)|se\s+puede\s+pagar\s+con|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|cu[aá]ndo\s+(se\s+)?paga|pago\s+al\s+recibir|pagar\s+al\s+recibir)/iu
/** Anything about the STATE of a payment or one already sent: never an info question (INT-93). */
const PAYMENT_STATUS_CUE_RE =
  /(acredit|se\s+aplic|aplicad|proces|reflej|v[aá]lid|correct|problema|est[aá]\s+bien|va\s+bien|se\s+hizo|se\s+ve|aparec|qued[oó]|entr[oó]|lleg[oó]|recib|vieron|ya\s+(lo|la|les|te)\s+(envi[eé]|mand[eé]|pas[eé]|hice|deposit[eé]|transfer[ií])|(mi|su)\s+(pago|sinpe|transferencia|dep[oó]sito)|envi[eé]|mand[eé]|pas[eé]|hice|deposit[eé]|transfer[ií]|pagu[eé]|pagamos|cancel[eé]|(le|les|se\s+l[oa]s?)\s+(envi|mand|pas)|todo\s+bien|ya\s+est[aá])/iu

function isPaymentInfoQuestion(value: string): boolean {
  return /[?¿]/.test(value) && PAYMENT_INFO_QUESTION_RE.test(value) && !PAYMENT_STATUS_CUE_RE.test(value)
}

/** Any payment word at all (media caption check: a photo with "sinpe" / "pago" is treated as a receipt). */
export function hasPaymentWord(text: string): boolean {
  return PAYMENT_RE.test(text || '') || hasPaymentProofCue(text) || hasPaymentClaimCue(text || '')
}

/**
 * agents2-format: right after the store asked "¿Cómo preferís pagar?", a short reply naming a method ("SINPE", "por
 * sinpe porfa", "transferencia") is a CHOICE, not a payment claim — but only with no proof / claim / confirm /
 * refund / payment-state cue at all ("ya hice el sinpe", "sinpe, ¿me confirmás?" stay with a person). Pure.
 */
/**
 * Done / sent words that make a method mention a CLAIM ("Sinpe pagado", "cancelado por sinpe", "listo, sinpe",
 * "sinpe ✅", "SINPE ya", "ahí le va el sinpe", "sinpe hace rato") — Verifier 2026-10-16.
 */
const CHOICE_CLAIM_WORD_RE =
  /(?<![\p{L}])(?:pagad\p{L}*|cancelad\p{L}*|list[oa]s?|hech[oa]s?|enviad\p{L}*|mandad\p{L}*|completad\p{L}*|realizad\p{L}*|transferid\p{L}*|depositad\p{L}*|ah[ií]\s+(?:le\s+|te\s+|les\s+)?va|hace\s+(?:un\s+)?rato|ya)(?![\p{L}])|[✅✔☑]/iu

export function isCueFreePaymentChoiceText(text: string): boolean {
  const value = (text || '').trim()
  if (!value || value.split(/\s+/).length > 25) return false
  return !(
    CHOICE_CLAIM_WORD_RE.test(value) ||
    SENT_AMOUNT_CLAIM_RE.test(value) ||
    PROOF_CUE_RE.test(value) ||
    hasPaymentClaimCue(value) ||
    CONFIRM_CUE_RE.test(value) ||
    CONFIRM_PAYMENT_RE.test(value) ||
    RISK_CUE_RE.test(value) ||
    PAYMENT_STATUS_CUE_RE.test(value)
  )
}

/** A payment method a customer can name. */
export type PaymentChoiceMethod = 'sinpe' | 'transferencia' | 'tarjeta' | 'contra_entrega' | 'efectivo'

/**
 * Completion / sent / approved words (INT-115, shared with the choice gate): "Transferencia realizada", "tarjeta
 * aprobada", "Listo, transferencia", "Envío exitoso", ✅ — a claim, never a question about how to pay.
 */
export const PAYMENT_COMPLETION_RE =
  /(?<![\p{L}])(?:realizad\p{L}*|hech[oa]s?|echo|enviad\p{L}*|list[oa]s?|lsito|exitos\p{L}*|aprobad\p{L}*|pagad\p{L}*|cancelad\p{L}*|completad\p{L}*|transferid\p{L}*|depositad\p{L}*)(?![\p{L}])|[✅✔☑]/iu

/** Invisible / formatting characters (zero-width, soft hyphen, BOM…) that could split a word ("he​cho"). */
const FORMAT_CHARS_RE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/gu

/** NFKC, invisible characters out, accents folded, lowercase, single spaces. Emoji and punctuation stay. */
function foldChoice(text: string): string {
  return (text || '')
    .normalize('NFKC')
    .replace(FORMAT_CHARS_RE, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const METHOD = String.raw`(sinpe(?: movil)?|transferencia|tarjeta|contra ?entrega|al recibir(?:lo|la)?|efectivo)`
const LEAD = String.raw`(?:(?:prefiero|mejor|quiero pagar|voy a pagar|pago|quisiera pagar)\s+)?(?:(?:por|con|en)\s+)?(?:el\s+|la\s+)?`
const TAIL = String.raw`(?:\s*,?\s*(?:porfa|por favor|gracias|pls))?[\s.!🙏😊🙌]*`
const ASK_HEAD = String.raw`¿?\s*(?:me\s+(?:pasas|pasa|das|da)|cual\s+es|a\s+que)\s+(?:el\s+|los\s+|la\s+)?(?:numero|cuenta|link|datos)`
const ASK_TAIL = String.raw`\s*\?*${TAIL}`
/** "SINPE", "por sinpe porfa", "Prefiero SINPE 🙏", "pago al recibirlo", "en efectivo". */
const CHOICE_RE = new RegExp(String.raw`^${LEAD}${METHOD}${TAIL}$`, 'u')
/** "quiero pagar por sinpe, ¿me pasás el número?" */
const CHOICE_THEN_ASK_RE = new RegExp(String.raw`^${LEAD}${METHOD}\s*,?\s*${ASK_HEAD}${ASK_TAIL}$`, 'u')
/** "¿cuál es el número de sinpe?", "¿me pasás los datos para pagar por transferencia?" */
const ASK_FOR_METHOD_RE = new RegExp(String.raw`^${ASK_HEAD}\s+(?:de|del|para)(?:\s+pagar\s+por)?(?:\s+(?:el|la))?\s+${METHOD}${ASK_TAIL}$`, 'u')
/** Anything that makes it more than a choice: digits, references, amounts, the done / like emojis. */
const CHOICE_REJECT_RE = /[\d#₡¢$✅✔☑👍💸]|(?<![\p{L}])ref(?![\p{L}])/u

function methodOf(word: string): PaymentChoiceMethod {
  if (word.startsWith('sinpe')) return 'sinpe'
  if (word === 'transferencia') return 'transferencia'
  if (word === 'tarjeta') return 'tarjeta'
  if (word === 'efectivo') return 'efectivo'
  return 'contra_entrega'
}

/**
 * SecureDog INT-114 (HIGH): a payment-method CHOICE is an ALLOWLIST GRAMMAR over the WHOLE message — an optional lead
 * ("prefiero", "quiero pagar", "por", "con"), ONE method, an optional "porfa / gracias" and only 🙏 😊 🙌; or the same
 * with one strict detail ask ("¿me pasás el número?"). `ask` = it carried that detail ask. Any digit, "#", "ref", ₡,
 * ✅ ✔ ☑ 👍 💸, a completion word or anything else → null (the classifier path: a person). Pure.
 */
export function paymentChoiceGrammar(text: string): { method: PaymentChoiceMethod; ask: boolean } | null {
  const raw = (text || '').normalize('NFKC').replace(FORMAT_CHARS_RE, '')
  if (!raw.trim() || raw.length > 160 || CHOICE_REJECT_RE.test(raw) || PAYMENT_COMPLETION_RE.test(raw)) return null
  const t = foldChoice(raw)
  if (CHOICE_REJECT_RE.test(t) || PAYMENT_COMPLETION_RE.test(t)) return null
  let m = CHOICE_RE.exec(t)
  if (m) return { method: methodOf(m[1]), ask: false }
  m = CHOICE_THEN_ASK_RE.exec(t) ?? ASK_FOR_METHOD_RE.exec(t)
  return m ? { method: methodOf(m[1]), ask: true } : null
}

/**
 * The method a message picks when it is SHAPED like a choice (paymentChoiceGrammar); `allowAsk` also accepts the strict
 * detail-ask forms. Also requires no claim / confirm / dispute cue (belt and braces). Pure.
 */
export function paymentChoiceShape(text: string, opts: { allowAsk?: boolean } = {}): PaymentChoiceMethod | null {
  if (!isCueFreePaymentChoiceText(text)) return null
  const g = paymentChoiceGrammar(text)
  return g && (opts.allowAsk || !g.ask) ? g.method : null
}

/** notifyHandoff reason code when a payment message goes to a person: 'complaint' (refund / dispute) or 'payment'. */
export function paymentHandoffReason(text: string): 'payment' | 'complaint' {
  const value = text || ''
  if (RISK_CUE_RE.test(value) || (REFUND_RE.test(value) && !isReturnPolicyQuestion(value))) return 'complaint'
  return 'payment'
}
