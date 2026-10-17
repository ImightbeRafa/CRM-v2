/**
 * Single deterministic payment classifier for the Soft Agent Layer.
 * Proof / confirmation / risk and ambiguous payment text stay human.
 * Information questions are payment_info_safe only when the cue is clear.
 */

import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'

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
  /(?:^|[^\p{L}\p{N}_])((?:me\s+)?confirm[aáeé]\p{L}*|ya\s+(?:les\s+|le\s+|te\s+|nos\s+)?(?:lleg|cay|entr)[oó]\p{L}*|revisen)/iu

const RISK_CUE_RE =
  /\b(reembolso|devoluci[oó]n\s+del\s+dinero|me\s+cobraron|doble\s+cobro|reclamo|disputa|fraude)\b/i

const INFO_CUE_RE =
  /\b(c[oó]mo\s+(pago|puedo\s+pagar|se\s+paga)|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|aceptan|n[uú]mero\s+(de\s+)?sinpe|sinpe\s+m[oó]vil|tarjeta|cuenta\s+(bancaria|iban)|transferencia)\b/i

const COD_QUESTION_RE =
  /(?<![\p{L}])(contra\s?entrega|pag(o|ar)\s+(al\s+recibir|cuando\s+(lo\s+|la\s+|me\s+)?(recib|lleg))|pago\s+en\s+efectivo\s+al|pag(o|ar)\s+(en|con)\s+efectivo(?![\p{L}]))/iu

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
      // SecureDog INT-140: "we / they paid" — third-person past always; the -amos forms (also present tense: "¿cómo
      // pagamos?") only after "ya" or with a past marker ("lo pagamos ayer").
      // Verifier round 6: "abonar" (a part payment) and a declined / rejected card or transfer are claims too.
      String.raw`abon[eé]|abonó|abonaron|ya\s+(?:se\s+)?(?:lo\s+|la\s+|le\s+|les\s+|te\s+)?abonamos|abonamos\s+(?:la\s+mitad|el\s+adelanto|una\s+parte|\d+)`,
      String.raw`(?:rechaz|declin)(?:aron|ó)|(?:fue|sali[oó]|me\s+(?:la\s+|lo\s+)?(?:sali[oó]|dio|dieron))\s+(?:rechazad|declinad)[oa]`,
      // SecureDog round 5 (INT-140): "les pasamos / mandaron la plata", "ya les enviamos los 15 mil", and "canceló /
      // transfirió / abonamos" on their own (Costa Rica: cancelar = pagar).
      String.raw`(?:pasamos|mandamos|enviamos|depositamos|pasaron|mandaron|enviaron|depositaron|pasó|mandó|envió)\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:plata|dinero|platica|₡\s?\d[\d.,\s]*|\d+(?:[.,\s]\d{3})*\s*(?:mil|k|colones|rojos)(?![\p{L}])|\d{4,})`,
      // Accented "canceló" only: "¿Cómo cancelo?" / "¿Si cancelo hoy…?" are questions about paying.
      String.raw`cancelamos\s+(?:la\s+mitad|el\s+resto|todo|ayer|anoche)|canceló|transfiri[oó]|abonamos|(?:mam[aá]|pap[aá]|esposo|esposa|hermano|hermana|novio|novia|hij[oa])\s+(?:ya\s+)?(?:lo\s+|la\s+|les?\s+)?cancel[oó]`,
      // SecureDog round 6: a third person doing the paying, accents or not ("mi esposo pago la mitad", "Mi esposo les
      // mando todo", "te deposito la mitad"); the perfect tense ("ha pagado", "hemos transferido"); "ahorita les cae el
      // sinpe"; a declined card in the present ("me sale rechazada", "me rechazo la tarjeta").
      String.raw`(?:esposo|esposa|marido|mam[aá]|mami|pap[aá]|papi|herman[oa]|novi[oa]|hij[oa]|amig[oa]|suegr[oa]|t[ií][oa]|prim[oa]|jefe|jefa)\s+(?:ya\s+)?(?:se\s+)?(?:le\s+|les\s+|te\s+|lo\s+|la\s+|me\s+)?(?:pag|deposit|transfiri|transfer|abon|cancel|mand|pas|envi|sinpe|sinpi|encarg|hiz|realiz)[oó]`,
      // SecureDog round 7: ANY third person ("mi cuñado", "mi señora", "Juan") + a paying verb in "-o": the present would
      // be "paga / cancela", so "-o" after a third-person subject is the past ("mi cuñado cancelo la mitad").
      String.raw`(?<![\p{L}])(?:mi|mis|su|sus|tu)\s+(?!forma|m[eé]todo|pago|tarjeta|cuenta|pedido)\p{L}{3,}\s+(?:ya\s+)?(?:se\s+)?(?:le\s+|les\s+|te\s+|lo\s+|la\s+|me\s+)?(?:pag|deposit|transfiri|abon|cancel|sinpe|sinpi|mand|pas|envi)[oó](?![\p{L}])`,
      // Object first: "la otra la cancelo mi cuñado", "lo pago mi esposo".
      String.raw`(?:lo|la|los|las)\s+(?:pag|deposit|transfiri|abon|cancel|sinpe|sinpi)[oó]\s+(?:mi|su|el|la|tu)\s+\p{L}{3,}`,
      // "les acabo de pasar los 20.000", "le acabo de enviar ₡20.000", "le hice el simpe", "ya fue pagado", "todo pagado".
      String.raw`acabo\s+de\s+(?:pasar|enviar|mandar|depositar|transferir|sinpear|tirar)|(?:le|les|te)\s+hice\s+(?:el|un)\s+(?:sinpe|simpe|pago|dep[oó]sito)|(?:ya\s+fue|todo|est[aá])\s+pagad[oa]|i\s+already\s+paid|already\s+paid|ya\s+les\s+tir[eé]`,
      String.raw`(?:he|ha|has|hemos|han)\s+(?:ya\s+)?(?:pagado|transferido|depositado|cancelado|abonado|enviado|mandado|pasado|sinpeado|sinpiado|hecho\s+(?:el|la|un|una)\s+(?:pago|sinpe|transferencia|dep[oó]sito))`,
      String.raw`(?:les?|te)\s+(?:cae|caer[aá]|va\s+a\s+caer)\s+(?:el\s+|la\s+)?(?:sinpe|pago|dep[oó]sito|plata|transferencia)`,
      // Verifier round 10: not a hypothetical ("¿Y si la tarjeta sale rechazada?", "¿qué pasa si me sale rechazada?").
      String.raw`(?<!(?:si|cuando)\s(?:\p{L}+\s){0,3})(?:me\s+)?(?:sale|salen|aparece)\s+(?:como\s+)?(?:rechazad[oa]|declinad[oa])|me\s+(?:la\s+|lo\s+)?(?:rechaz|declin)[oó]`,
      // Verifier round 8: "la plata ya está", "le di la plata al mensajero".
      String.raw`(?:plata|platica|dinero|pago|sinpe|transferencia|dep[oó]sito|adelanto)\s+ya\s+est[aá]|(?:le|les|te)?\s*di\s+(?:la\s+plata|el\s+dinero|el\s+pago|la\s+platica)`,
      String.raw`pagaron|depositaron|transfirieron|cancelaron|sinpearon|sinpeamos|sinpiaron|sinpiamos|sinpe[eé]|sinpi[eé]|sinpe[oó]|sinpi[oó]|(hicimos|hicieron|mandamos|mandaron|enviamos|enviaron)\s+(el|la|un|una)\s+(sinpe|pago|dep[oó]sito|transferencia)`,
      String.raw`ya\s+(?:se\s+)?(?:lo\s+|la\s+|le\s+|les\s+|te\s+)?(pagamos|depositamos|transferimos|cancelamos|sinpeamos|pag[oó]|deposit[oó]|transfiri[oó]|cancel[oó])`,
      String.raw`(?:lo\s+|la\s+|le\s+|les\s+|te\s+)(pagamos|depositamos|transferimos|cancelamos)\s+(ayer|hoy|anoche|esta\s+ma[nñ]ana|hace)`,
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
    String.raw`|(c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]\s+formas?\s+de)(\s+\p{L}+){0,2}\s+(pago|pagar|se\s+paga|pagos|pagamos)` +
    String.raw`|(reciben|tienen|aceptan|usan|trabajan\s+con)\s+(sinpe|transferencias?|tarjetas?|efectivo)` +
    // SecureDog round 7: the "si pago hoy" / "¿pago la mitad…?" shapes were removed again — they let half-payment claims
    // ("¿Pago la mitad hoy si mi cuñado cancelo la otra?") reach the model; those questions go to a person, as on live.
    String.raw`)(?![\p{L}])`,
  'iu',
)

/**
 * luna-10 exam + SecureDog INT-136/137: two plain questions the agent answers — "¿puedo hacerles un sinpe…?" (paying in
 * the future) and "¿tienen link de pago?". Only the exact shapes, and refused when anything in the message looks like a
 * claim, a status, a refund or someone else's account ("ya lo envié", "lo realicé", "lo mandamos", "a mi cuenta",
 * "de vuelta", "lo que sobró", "ya lo usé"). Checked after every claim check; anything doubtful stays with a person.
 */
// Verifier round 6: an ALLOWLIST over the whole message, not a list of banned claim words. Each shape is the question
// itself, plus only these pieces around it: a greeting / thanks, "quiero / necesito comprar <product words>", and (link
// only) one product-recommendation follow-up. Anything else — any statement, any verb, a second "?" — → a person.
const FUTURE_SINPE_QUESTION_RE =
  /(?<![\p{L}])(?:puedo|se\s+puede|podr[ií]a)\s+hacer(?:les|te|le)\s+(?:un|una|el|la)\s+(?:sinpe|transferencia|dep[oó]sito)(?![\p{L}])/iu
/** What may sit between the SINPE question and its "?": nothing, or the pickup add-on from the real exam chat. */
const SINPE_INNER_OK_RE =
  /^\s*(?:\s*(?:hoy|ma[nñ]ana|ahora|ahorita|m[aá]s\s+tarde|en\s+la\s+(?:noche|tarde|ma[nñ]ana)|hoy\s+en\s+la\s+(?:noche|tarde)|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)))?(?:,?\s*(?:y|para)\s+(?:mandar|enviar)\s+(?:un|a\s+un|el)?\s*(?:flash|mensajero|motorizado|uber|taxi|amig[oa]|familiar)(?:\s+(?:a\s+)?(?:recoger|retirar|traer)\p{L}*)?)?\s*(?:,?\s*(?:por\s+favor|porfa))?\s*$/iu
// Every common way to ASK for the link ("Me envías el link de pago", "pasame el link", "¿me podés pasar…?").
const PAYMENT_LINK_ASK_RE =
  /(?<![\p{L}])(?:(?:ustedes\s+)?tienen|no\s+tienen|ten[eé]s|tienes|hay|quiero|quisiera|necesito|cu[aá]l\s+es|me\s+(?:podr[ií]as?\s+(?:pasar|enviar|mandar|compartir)|regalan|regal[aá]s|env[ií]an|pas[aá]s|pasa|pasan|mand[aá]s|manda|mandan|env[ií]as|env[ií]a|env[ií]an|das|da|dan|regal[aá]s|regala|compart[ií]s|comparte|comparten|pod[eé]s\s+(?:pasar|enviar|mandar|compartir)|puede\s+(?:pasar|enviar|mandar|compartir)|pueden\s+(?:pasar|enviar|mandar|compartir))|p[aá]same|p[aá]seme|m[aá]ndame|m[aá]ndeme|env[ií]ame|env[ií]eme|comp[aá]rteme)\s+(?:un\s+|el\s+)?(?:link|enlace)\s+(?:de|para)\s+(?:pago|pagar)(?![\p{L}])/iu
/** A bare "¿link de pago?" — the WHOLE message ("El link de pago venció?" is not this). */
const BARE_LINK_QUESTION_RE = /^\s*¿?\s*(?:y\s+)?(?:el\s+)?(?:link|enlace)\s+(?:de|para)\s+(?:pago|pagar)\s*[?!.]*\s*$/iu
/** Any mention of a payment link: a link message that is not a plain ask goes to a person (never the info cue). */
const PAYMENT_LINK_WORDS_RE = /(?<![\p{L}])(?:link|enlace|links|enlaces)(?![\p{L}])/iu

const PAY_LINK_PHRASE_RE = /(?<![\p{L}])(?:link|enlace)s?\s+(?:de|para|del)\s+(?:pago|pagar|cobro)(?![\p{L}])/iu
const LINK_FAILURE_RE =
  /(?<![\p{L}])(?:venc\p{L}*|expir\p{L}*|caduc\p{L}*|sirv\p{L}*|sirve|funcion\p{L}*|abr[eií]\p{L}*|abre|ca[ií]d[oa]|rechaz\p{L}*|declin\p{L}*|fall\p{L}*|error|us[eéoó]|otro|otra\s+vez|de\s+nuevo|carg[oó]|cobr[oó])(?![\p{L}])/iu
const FRIENDLY_RE = /[😊🙏🙌🥰❤️👋🏻🏼🏽🏾🏿️😁☺😄😃🤗✨💕💚🌸]/gu
const GREETING = String.raw`hol+a+|holi|holis|pura\s+vida|upe|diay|mae|bueno|va|ah\s+ok|ah\s+bueno|buenas|buen\s+d[ií]a|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|hey|saludos|disculpe|disculp[aá]|una\s+consulta|consulta|(?:muchas\s+)?gracias|ok|okay|okey|perfecto|genial|excelente|s[uú]per|dale|claro|s[ií]|por\s+favor|porfa`
const PRODUCT_WORD = String.raw`(?:los|las|el|la|unos|unas|un|una|de|del|y|para|\d+|dos|tres|cuatro|cinco|seis|ambos|todo|parches?|paquetes?|cajas?|combos?|kits?|productos?|unidades?|eso|esos|esto|estos|esta|estas|ese|esa|esas|glp-?1|glp|sue[nñ]o|dormir|energ[ií]a|ansiedad|calma|focus|enfoque|hambre|antojos?)`
const BUY = String.raw`(?:(?:quiero|queremos|necesito|quisiera|me\s+gustar[ií]a|voy\s+a|vamos\s+a)\s+(?:comprar|pedir|encargar|llevar|ordenar)|quiero|queremos|me\s+interesan?|me\s+(?:(?:lo|la|los|las)\s+)?llevo)(?:\s+${PRODUCT_WORD}){0,8}`
/** Only greetings / thanks / "quiero comprar los 2 parches", separated by punctuation, may come before the question. */
const OK_PREFIX_RE = new RegExp(String.raw`^(?:[\s,.!¡¿]*(?:${GREETING}|${BUY})(?![\p{L}\d]))*[\s,.!¡¿]*$`, 'iu')
/** The one follow-up the link may carry: "¿Para la ansiedad cuáles me recomendás?" (a real PatchHouse chat). */
const RECOMMEND_FOLLOWUP_RE =
  /^[\s,.!¡¿]*(?:y\s+)?(?:para\s+(?:la|el|los|las|mi)?\s*(?:ansiedad|sue[nñ]o|dormir|energ[ií]a|calma|enfoque|focus|hambre|antojos?|estr[eé]s)\s*,?\s*)?(?:cu[aá]l(?:es)?|qu[eé](?:\s+parches?)?)\s+(?:me\s+)?recomend[aá]s\s*\?[\s?!.]*$|^[\s,.!¡¿]*(?:y\s+)?(?:para\s+(?:la|el|los|las|mi)?\s*(?:ansiedad|sue[nñ]o|dormir|energ[ií]a|calma|enfoque|focus|hambre|antojos?|estr[eé]s)\s*,?\s*)?(?:cu[aá]l(?:es)?|qu[eé](?:\s+parches?)?)\s+(?:me\s+)?recomiendas\s*\?[\s?!.]*$/iu
/** Nothing but spaces and closing punctuation. */
const EMPTY_TAIL_RE = /^[\s?!¡.,…]*$/u

function clean(value: string): string {
  return (value || '').normalize('NFKC').replace(FRIENDLY_RE, ' ')
}

export function isPlainFutureSinpeQuestion(value: string): boolean {
  const v = clean(value)
  if (v.length > 300) return false
  const m = FUTURE_SINPE_QUESTION_RE.exec(v)
  if (!m) return false
  const after = v.slice(m.index + m[0].length)
  const q = after.indexOf('?')
  // A closed question; only the allowed add-on before its "?", nothing after it, only greetings / "quiero comprar…" before.
  if (q < 0) return false
  // "¿Ya puedo hacerles el sinpe?": a "ya" right before the SINPE question is "now"; nowhere else ("Ya tienen el link").
  return OK_PREFIX_RE.test(v.slice(0, m.index).replace(/(?<![\p{L}])ya\s*$/iu, '')) && SINPE_INNER_OK_RE.test(after.slice(0, q)) && EMPTY_TAIL_RE.test(after.slice(q + 1))
}

export function isPlainPaymentLinkQuestion(value: string): boolean {
  const v = clean(value)
  if (v.length > 300) return false
  if (BARE_LINK_QUESTION_RE.test(v)) return true
  const m = PAYMENT_LINK_ASK_RE.exec(v)
  if (!m || !OK_PREFIX_RE.test(v.slice(0, m.index))) return false
  const after = v.slice(m.index + m[0].length)
  if (EMPTY_TAIL_RE.test(after) || /^\s*,?\s*(?:por\s+favor|porfa|gracias)[\s?!.,]*$/iu.test(after)) return true
  // "…link de pago? <one recommendation question>" — nothing else.
  const q = after.indexOf('?')
  return q >= 0 && /^\s*(?:,?\s*(?:por\s+favor|porfa))?\s*$/iu.test(after.slice(0, q)) && (RECOMMEND_FOLLOWUP_RE.test(after.slice(q + 1)) || /^\s*,?\s*(?:muchas\s+)?(?:gracias|por\s+favor|porfa)[\s?!.,]*$/iu.test(after.slice(q + 1)))
}


/**
 * SecureDog round 5 (INT-141): the info / contra-entrega / "how do I pay" exits answer ONLY a message made of asks.
 * Every sentence must be a greeting / thanks / "quiero comprar…", or a question ("…?") or a closing request ("quiero
 * pagar con tarjeta", "me pasás el número") — and nothing may read like something that already happened: a past-tense
 * verb ("canceló", "realicé", "pagaron", "hicimos"), a completion word ("hecho", "listo", ✅) or "ya". A statement
 * ("Mamá lo canceló", "La transferencia ya está") → a person.
 */
const ASK_START_RE =
  /^(?:y\s+)?(?:(?:ya\s+)?(?:lo\s+|la\s+)?(?:tengo|estoy|estamos)\s+list[oa]s?\s+para|(?:te\s+|le\s+|les\s+)?pago|me\s+(?:lo|la|los|las)\s+llevo|me\s+pregunt\p{L}*|quer[ií]a\s+saber|quisiera\s+saber|una\s+pregunta|tengo\s+una\s+(?:duda|pregunta|consulta)|(?:s[ií]\s*,?\s*)?contra\s*entrega|en\s+efectivo|quiero|quisiera|queremos|necesito|me\s+gustar[ií]a|voy\s+a|vamos\s+a|prefiero|mejor|me\s+pas\p{L}*|p[aá]same|p[aá]seme|dame|d[eé]me|m[aá]ndame|env[ií]ame|me\s+(?:da|das|dan|manda|mand[aá]s|env[ií]a|env[ií]as)|c[oó]mo|cu[aá]l\p{L}*|cu[aá]ndo|cu[aá]nto\p{L}*|d[oó]nde|qu[eé]|puedo|podemos|se\s+puede|pueden|aceptan|reciben|tienen|ten[eé]s|tienes|hacen|hay|trabajan|es\s+posible|ser[ií]a)(?![\p{L}])/iu
/** Accented endings that are not a past tense: question words, "está", "más", "mamá", futures ("llegará"). */
const ACCENT_OK = new Set(['dé', 'qué', 'está', 'están', 'más', 'sí', 'así', 'aquí', 'ahí', 'allí', 'acá', 'allá', 'mí', 'tú', 'él', 'sé', 'también', 'después', 'además', 'café', 'bebé', 'mamá', 'papá', 'jamás', 'quizá', 'según', 'menú', 'maní', 'podés', 'tenés', 'querés', 'sabés', 'hacés', 'mandás', 'pasás', 'enviás', 'recomendás', 'preferís', 'decís', 'aceptás', 'usás'])
const PAST_OR_DONE_RE =
  /(?<![\p{L}])(?:already|sent|done|paid|est[aá]\s+(?:pago|pagad[oa]|cancelad[oa])|\p{L}+(?:aron|eron)|(?:pag|us|complet|mand|envi|transfer|deposit|realiz|cancel|abon|sinpe|pas)amos|hicimos|transferimos|transfirio|ya(?!\s+(?:lo\s+|la\s+|los\s+|las\s+)?(?:puedo|podemos|quiero|queremos|tengo|tenemos|estoy|estamos|decid\p{L}*|eleg\p{L}*)))(?![\p{L}])/iu
const PAGAMOS_QUESTION_RE = /^(?:y\s+)?(?:c[oó]mo|cu[aá]ndo|d[oó]nde|por\s+d[oó]nde)\s+(?:les?\s+|lo\s+)?pagamos(?:\s+(?:el\s+resto|eso|todo))?\s*\?[\s?!.]*$/iu

/** Past-tense "-ré" words that are not futures ("compré", "entré"); every other "-ré / -rá" is a future ("podré"). */
const PAST_RE_WORDS = new Set(['tiré', 'giré', 'compré', 'entré', 'mostré', 'encontré', 'pregunté', 'registré', 'cobré'])

function hasPastOrDoneWord(segment: string, question: boolean): boolean {
  const s = PAGAMOS_QUESTION_RE.test(segment) ? segment.replace(/pagamos/iu, 'pagar') : segment
  if (PAST_OR_DONE_RE.test(s)) return true
  // Verifier round 9: outside a question, a done-verb is a claim even with no payment noun ("¿Aceptan sinpe? Le hice
  // uno", "Le tiré hace un toque", "Contra entrega se lo di al mensajero", "Te lo pase en la mañana").
  if (!question && /(?<![\p{L}])(?:hice|hizo|hicimos|hicieron|di|d[ií]|dimos|dieron|tir[eé]|gir[eé]|mand[eé]|envi[eé]|pas[eé]|realic[eé]|deposit[eé]|transfer[ií])(?![\p{L}])/iu.test(s.replace(/(?<![\p{L}])(?:que\s+)?(?:me|nos)\s+(?:l[oa]s?\s+)?(?:mande|envie|pase)(?![\p{L}])|(?<![\p{L}])que\s+(?:se\s+)?(?:l[oa]s?\s+)?(?:mande|envie|pase)(?![\p{L}])/giu, ' '))) return true
  // "¿Cuándo está listo?", "¿Son hechos a mano?", "¿cuánto tarda en ser enviado?": inside a QUESTION a completion word
  // is about the order; outside one ("…? hecho", "listo, ya la pasé") it is a claim. ✅ ✔ ☑ are never a question.
  // "listo para pagar" = ready to pay (not done).
  if (PAYMENT_COMPLETION_RE.test(s.replace(/(?<![\p{L}])list[oa]s?\s+para(?![\p{L}])/giu, ' ')) && (!question || /[✅✔☑]/u.test(s))) return true
  // Verifier round 8: a capitalised word after the first one is a name or a place ("José", "Jacó", "San José").
  for (const m of s.matchAll(/\p{L}+/gu)) {
    const w = m[0]
    const lw = w.toLowerCase()
    if (!/[éíó]$/u.test(lw) || ACCENT_OK.has(lw)) continue
    if ((m.index ?? 0) > 0 && /^\p{Lu}/u.test(w)) continue
    if (/r[éá]$/u.test(lw) && !PAST_RE_WORDS.has(lw)) continue
    return true
  }
  return false
}

/** A payment noun / verb: a STATEMENT carrying one ("Está pago", "La plata está") is never plain context. */
// SecureDog round 6: also "doing" verbs and amounts — "Le mande.", "Mi esposo se encargo.", "Se lo dio al mensajero.",
// "Le pase 20.000." are not plain context.
const PAY_STATEMENT_RE =
  /(?<![\p{L}])(?:pag\p{L}*|plata|platica|dinero|comprobante\p{L}*|sinpe\p{L}*|sinpi\p{L}*|transfer\p{L}*|transfi\p{L}*|dep[oó]sit\p{L}*|tarjeta\p{L}*|abon\p{L}*|cancel\p{L}*|cobr\p{L}*|cargo\p{L}*|recibo|monto|saldo|adelanto|resto|mitad|link|enlace|mand\p{L}*|pas[eéoó]|pasamos|pasaron|envi[eéoó]|enviamos|enviaron|encarg\p{L}*|di[oó]?|dimos|dieron|entreg\p{L}*|hic\p{L}*|hech\p{L}*|resolv\p{L}*|arregl\p{L}*|lleg\p{L}*|ca[ií]\p{L}*|cae|caer\p{L}*|todo|₡)(?![\p{L}])|(?<![\d-])\d{1,3}(?:[.,]\d{3})+(?![\d-])|\d+\s*(?:mil|k|rojos|colones)(?![\p{L}])/iu
/** Opening words before the ask in a sentence ("Hola, …", "Pura vida, …", "Bueno, …"). */
const LEADING_GREETING_RE = new RegExp(String.raw`^(?:(?:${GREETING})(?![\p{L}\d])[\s,]+)+`, 'iu')

export function isPlainAskMessage(value: string): boolean {
  // A strict whole-message method choice ("Por SINPE está bien", "Te pago por sinpe") is an answer, not a claim.
  if (paymentChoiceGrammar(value)) return true
  // A leading "Listo, / Ok listo," before more text is an acknowledgement ("Listo, ¿cómo pago?").
  const v = clean(value).replace(/^\s*(?:(?:ok|okay|dale|bueno|perfecto)[\s,.!]+)?list[oa][\s,.!]+(?=\S)/iu, '')
  if (!v.trim() || v.length > 300) return false
  // SecureDog round 6: "¿" opens a new sentence too ("Pagado, ¿cómo pago el envío?" = "Pagado." + "¿cómo pago…?").
  const segments = (v.replace(/¿/gu, '\u0001¿').match(/[^.!?\n\u0001]+[.!?\n\u0001]*/gu) ?? []).map((raw) => raw.replace(/^[\s¿¡,]+/u, '').trim())
  if (!segments.length) return false
  // Verifier round 8: every sentence is checked for a claim, then must be a greeting / thanks, a question, a request
  // ("quiero pagar con tarjeta", "pago contra entrega", wherever it sits) or plain context with no payment word
  // ("Tengo una duda.", "Vivo en Heredia.", "Ana Rojas") — a thanks after the ask no longer hides it.
  return segments.every((seg0) => {
    const lead = /\u0001$/u.test(seg0)
    const seg = seg0.replace(/[\s,\u0001]+$/u, '')
    if (!seg || EMPTY_TAIL_RE.test(seg) || OK_PREFIX_RE.test(seg)) return true
    const question = /\?[\s?!.]*$/u.test(seg)
    if (hasPastOrDoneWord(seg, question)) return false
    if (lead && !/(?<![\d-])\d{1,3}(?:[.,]\d{3})+(?![\d-])|\d+\s*(?:mil|k|rojos|colones)(?![\p{L}])|₡/iu.test(seg) && !/(?<![\p{L}])(?:no\s+(?:me\s+)?(?:pasa|pas[oó]|funciona\p{L}*|sirv\p{L}*|sirve|carga|abre|entra|deja|acept\p{L}*)|rechaz\p{L}*|declin\p{L}*|error|fall\p{L}*|cargo\p{L}*|cobr\p{L}*|recibo|comprobante\p{L}*|voucher|abon\p{L}*|di[oó]|dieron|dimos|aparec\p{L}*|sale|sali[oó]|resolv\p{L}*|arregl\p{L}*|encarg\p{L}*|mand[oó]|envi[oó]|pas[oó]|hiz[oó]|lleg[oó]|cay[oó]|entr[oó]|ya|mitad|resto|adelanto|saldo)(?![\p{L}])/iu.test(seg)) return true
    if (question) return true
    const body = seg.replace(LEADING_GREETING_RE, '')
    return ASK_START_RE.test(body) || !PAY_STATEMENT_RE.test(body)
  })
}

/** An agent-side exit only for a plain ask; anything else with payment words → a person. */
function plainOr(value: string, cls: PaymentClassification): PaymentClassification {
  return isPlainAskMessage(value) ? cls : 'payment_proof_or_risk'
}

/** Refund wording (INT-81): goes to a person unless it is a plain return-policy question. */
const REFUND_RE = /(?<![\p{L}])(devol\p{L}*|devuelv\p{L}*|regres(en|e|ar|ame|enme)\s+(la\s+plata|el\s+dinero|mi\s+plata|mi\s+dinero|lo\s+que\s+(di|pagu[eé])))/iu
// A greeting may come first ("Hola, ¿puedo devolverlo si no me queda?"); only the FIRST sentence is the question.
const RETURN_POLICY_QUESTION_RE =
  /^\s*((hola|buenas|buenos\s+d[ií]as|buenas\s+(tardes|noches)|disculpe|una\s+consulta|consulta)[\s,.!]*)?¿?\s*(puedo|se\s+puede|pueden|c[oó]mo|hacen|aceptan|tienen|hay|cu[aá]l\s+es|qu[eé])(?![\p{L}])[^.!?\n]*(devol\p{L}*|devuelv\p{L}*|cambi\p{L}*)/iu
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
  // SecureDog r4: the end stays ASCII-only like the old \b ("pagaré", "pagaría" still count); INT-140 adds "we / they
  // paid" so the status checks and the photo-as-receipt rule see them.
  /\b(sinpe|transferencia|pago|pagar|comprobante|ib[aá]n|cuenta\s*banc|dep[oó]sit[oa]|efectivo\s*contra|pagamos|pagaron|depositamos|depositaron|transferimos|transfirieron|cancelamos|cancelaron)(?![A-Za-z0-9_])/iu

export function hasPaymentProofCue(text: string): boolean {
  return PROOF_CUE_RE.test(text || '')
}

export function hasPaymentRiskCue(text: string): boolean {
  return RISK_CUE_RE.test(text || '')
}

/** "Le envié 15 mil", "Te mandé ₡20.000", "Envié 15000 hace un rato": a payment claim even with no payment word (MEDIA-15). */
const SENT_AMOUNT_CLAIM_RE =
  // SecureDog round 6: plural / third person and dotted thousands ("Ya les pasamos 15.000", "Te mandé 20.000").
  /(?<![\p{L}])(envi[eé]|mand[eé]|pas[eé]|deposit[eé]|transfer[ií]|pagu[eé]|hice|pasamos|mandamos|enviamos|depositamos|pasaron|mandaron|enviaron|depositaron|pas[oó]|mand[oó]|envi[oó]|deposit[oó]|transfiri[oó])(?:\s+\p{L}+){0,2}?\s+(?:₡\s?\d|\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,\s]\d{3})*\s*(?:mil|k|colones|rojos)(?![\p{L}])|\d{4,})/iu

/**
 * Verifier round 10: an EARLIER message of a burst counts only for a real claim (a receipt, "ya pagué", a status, a
 * completion, a done-verb about money) — never the "payment word and no question" fallback, so "Sinpe" + "gracias"
 * after "¿Cómo preferís pagar?" or "No tengo sinpe" + "¿aceptan tarjeta?" stay answers.
 */
export function hasHardPaymentClaim(text: string): boolean {
  const value = stripFormatChars((text || '').normalize('NFKC'))
  return (
    SENT_AMOUNT_CLAIM_RE.test(value) ||
    PROOF_CUE_RE.test(value) ||
    hasPaymentClaimCue(value) ||
    CONFIRM_CUE_RE.test(value) ||
    CONFIRM_PAYMENT_RE.test(value) ||
    RISK_CUE_RE.test(value) ||
    hasPaymentStatusClaim(value) ||
    isPaymentCompletionClaim(value) ||
    (!/\?/.test(value) && PAY_STATEMENT_RE.test(value) && hasPastOrDoneWord(value, false))
  )
}

export function classifyPaymentText(
  text: string,
  /** The store's method question is pending (sales-state): an exact method choice is then a sales answer. */
  opts: { awaitingPaymentMethod?: boolean } = {},
): PaymentClassification {
  // SecureDog: full-width / invisible-character spellings ("ＳＩＮＰＥ ✅", "he\u200Bcho") are read as plain text.
  const value = stripFormatChars((text || '').normalize('NFKC'))
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
  // INT-114 reopened: third-person payments, "salió / se fue / entró", times ("ayer", "esta mañana", "a las tres"),
  // "desde la cuenta / al número / a nombre de", "verifiquen", "ahí le va", "me avisa" next to a payment noun.
  // SecureDog INT-139: checked BEFORE the contra-entrega shortcut ("contra entrega? el sinpe salió ayer" is a claim).
  if (hasPaymentStatusClaim(value)) return 'payment_proof_or_risk'
  // INT-115: "Transferencia realizada", "tarjeta aprobada", "Listo, transferencia", ✅ — a claim, not an info question.
  if (isPaymentCompletionClaim(value)) {
    return 'payment_proof_or_risk'
  }
  if (COD_QUESTION_RE.test(value)) {
    return plainOr(value, 'non_payment')
  }
  // The store asked "¿Cómo preferís pagar?": an exact choice ("SINPE", "Por SINPE está bien") or a choice + a
  // logistics phrase ("Por sinpe y retiro en tienda") is a sales answer — only after every claim check above.
  if (opts.awaitingPaymentMethod && (paymentChoiceGrammar(value) || pendingMethodMention(value))) return 'non_payment'
  // The strict detail ask ("Quiero pagar por SINPE, ¿me pasás el número?") is an info question.
  if (paymentChoiceGrammar(value)?.ask) return 'non_payment'
  // Follow-up: future / intent phrasing ("Listo, quiero pagar por sinpe", "¿El pago tiene que estar hecho antes del
  // envío?") and a bare method question after an "ok" ("Lista, ¿por sinpe?") are not claims — the agent answers.
  // (A plain "¿cómo puedo pagar?" keeps the info path below: the method list.)
  // Verifier round 7: a payment-link message that is not a plain ask goes to a person — checked before the intent path
  // ("Quiero pagar con el link, el otro venció"). Only "link de pago" or a link next to a failure / used word; "¿tienen
  // link para comprar?" and "vi el link en la bio" are ordinary.
  if (isPlainPaymentLinkQuestion(value)) return 'payment_info_safe'
  // Verifier round 8: "¿Puedo pagar con link de pago?" is a plain ask; only a failure word or a non-plain message hands off.
  if (PAYMENT_LINK_WORDS_RE.test(value) && (LINK_FAILURE_RE.test(value) || (PAY_LINK_PHRASE_RE.test(value) && !isPlainAskMessage(value)))) return 'payment_proof_or_risk'
  // SecureDog round 5: the intent path too answers only a plain ask (a leading "listo," is an acknowledgement).
  if (isPaymentIntentText(value) && !INFO_CUE_RE.test(value)) return plainOr(value.replace(LEADING_LISTO_RE, ''), 'non_payment')
  // Only after an "ok / listo" and with "por / con" ("Lista, ¿por sinpe?"); a bare "sinpe?" stays ambiguous (a person).
  if (
    /[?¿]/.test(value) &&
    LEADING_LISTO_RE.test(value) &&
    /(?<![\p{L}])(?:por|con)(?![\p{L}])/iu.test(value) &&
    paymentChoiceGrammar(value.replace(LEADING_LISTO_RE, '').replace(/[¿?]/g, ' '))
  ) {
    return 'non_payment'
  }
  if (isPlainPaymentLinkQuestion(value)) return 'payment_info_safe'
  // SecureDog r4: a link question that is NOT plain ("¿tienes link de pago? me rechazó la tarjeta") goes to a person,
  // never down to the generic "tarjeta / transferencia" info cue.
  if (INFO_CUE_RE.test(value)) {
    return plainOr(value, 'payment_info_safe')
  }
  if (isPlainFutureSinpeQuestion(value)) return 'non_payment'
  // An explicit "how / can I pay" question ("¿puedo pagar en efectivo?", "¿cuándo se paga?") is answered by the agent
  // under the fixed payment rules; everything else with payment words stays with a person (fail closed).
  if (PAYMENT_RE.test(value) && PAYMENT_QUESTION_RE.test(value)) {
    return plainOr(value, 'non_payment')
  }
  // B5 (Agentes IA 2.0), narrowed after SecureDog INT-93: ONLY an explicit list of info questions reaches the agent
  // ("¿el pago es por adelantado?", "¿con qué banco es el sinpe?", "¿aceptan tarjeta?") and never one that asks about
  // the state of a payment ("¿se acreditó el pago?", "¿mi sinpe es válido?"). Everything else stays with a person.
  if (PAYMENT_RE.test(value) && isPaymentInfoQuestion(value)) {
    return plainOr(value, 'non_payment')
  }
  if (PAYMENT_RE.test(value)) {
    return 'payment_proof_or_risk'
  }
  return 'non_payment'
}

/** Plain info questions about HOW the store takes payment (explicit list — never a generic "question" heuristic). */
const PAYMENT_INFO_QUESTION_RE =
  /(adelantad|anticipad|con\s+qu[eé]\s+banco|qu[eé]\s+bancos?|a\s+qu[eé]\s+(n[uú]mero|cuenta)|cu[aá]l\s+es\s+(el\s+|la\s+)?(n[uú]mero|sinpe|cuenta|iban)|me\s+pas[aá]s?\s+(el\s+n[uú]mero|los\s+datos|la\s+cuenta)|aceptan\s+(tarjetas?|sinpe|transferencias?|efectivo)|se\s+puede\s+pagar\s+con|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|cu[aá]ndo\s+(se\s+)?paga|pago\s+al\s+recibir|pagar\s+al\s+recibir)/iu
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

const COMPLETION_WORD = String.raw`(?:realizad\p{L}*|hech[oa]s?|echo|enviad\p{L}*|mandad\p{L}*|list[oa]s?|lsito|exitos\p{L}*|aprobad\p{L}*|pagad\p{L}*|cancelad\p{L}*|completad\p{L}*|transferid\p{L}*|depositad\p{L}*)`
const COMPLETION_PAY_NOUN = String.raw`(?:sinpe|transferencias?|pagos?|dep[oó]sitos?|tarjetas?|plata|dinero|comprobantes?)`
/** A completion word within 2 words of a payment noun, either order ("transferencia realizada", "pagado con tarjeta"). */
const COMPLETION_NEAR_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:${COMPLETION_PAY_NOUN}(?:\s+[\p{L}\p{N}]+){0,2}?\s+${COMPLETION_WORD}|${COMPLETION_WORD}(?:\s+[\p{L}\p{N}]+){0,2}?\s+${COMPLETION_PAY_NOUN})(?![\p{L}])`,
  'iu',
)
/** Completion words that are about something else (N1): a price list, hand-made, shipping, the ORDER being ready. */
const COMPLETION_NOT_PAYMENT_RE =
  /(?<![\p{L}])(?:list[oa]s?\s+de\s+\p{L}+|hech[oa]s?\s+a\s+mano|(?:es|ser|son|sea|sean|ser[aá]n?|fue|fueron)\s+enviad\p{L}*|(?:est[aá]n?|tienen|tiene|tengo|tenga|tengan|queda|quede)\s+(?:\p{L}+\s+)?list[oa]s?)(?![\p{L}])/giu
/** A leading "listo," / "ok listo" / "listo!" is agreement, not a completion. */
const LEADING_LISTO_RE = /^\s*(?:(?:ok|okay|dale|bueno|perfecto)[\s,.!]+)?list[oa][\s,.!]+/iu
/** Info questions (how / where / which number / do you accept): a question about paying, never a claim. */
const INFO_QUESTION_CUE_RE = /c[oó]mo\s+(?:\p{L}+\s+){0,2}(?:pag\p{L}*|hago)|aceptan|reciben|a\s+qu[eé]\s+n[uú]mero|cu[aá]l\s+es|puedo\s+pagar|me\s+pas[aá]s?|tienen|se\s+puede|tiene\s+que|hay\s+que|deb[eo]\s/iu

/**
 * INT-115 narrowed (N1): a completion word is a payment CLAIM only next to a payment noun ("transferencia realizada",
 * "pagado con tarjeta", "sinpe listo", "envío exitoso", ✅ with a payment noun), or — in a message with no question —
 * paired with a payment noun anywhere ("Listo, transferencia"). Never: a leading "listo," / "ok listo", "lista de
 * precios", "hechos a mano", "ser enviado", the order being "listo", or an info question ("Listo, ¿cómo pago?").
 */
/** Intent / future phrasing around paying: never a completion claim by itself. */
const PAYMENT_INTENT_RE =
  /(?<![\p{L}])(?:quiero\s+pagar|voy\s+a\s+pagar|prefiero\s+pagar|puedo\s+pagar|quisiera\s+pagar|para\s+pagar|(?:le|te|les)\s+pago|pagar[ií]a|tengo\s+que\s+pagar|hay\s+que\s+pagar|antes\s+del\s+env[ií]o|despu[eé]s\s+del\s+pago)(?![\p{L}])/iu
/** Strong completion markers that win over intent wording ("ya pagué", ✅, an amount, a reference, "realizada"…). */
const STRONG_COMPLETION_RE =
  /[✅✔☑₡#\d]|(?<![\p{L}])(?:ref|ya|pagu[eé]|pagad\p{L}*|hab[ií]a|anterior|comprobante\p{L}*|realizad\p{L}*|exitos\p{L}*|aprobad\p{L}*|doble|error)(?![\p{L}])|ya\s+(?:lo\s+|la\s+|le\s+|te\s+|les\s+)?(?:hice|pagu[eé]|envi[eé]|mand[eé])/iu

/**
 * Follow-up to N1: intent phrasing with no strong completion marker and no claim / status cue (a leading "listo," /
 * "ok listo" is an acknowledgement) — the customer is about to pay or asking about it.
 */
export function isPaymentIntentText(text: string): boolean {
  const value = text || ''
  if (!PAYMENT_INTENT_RE.test(value) || STRONG_COMPLETION_RE.test(value) || hasPaymentStatusClaim(value)) return false
  const v = value.replace(LEADING_LISTO_RE, '')
  return !(
    PROOF_CUE_RE.test(v) ||
    hasPaymentClaimCue(v) ||
    CONFIRM_CUE_RE.test(v) ||
    CONFIRM_PAYMENT_RE.test(v) ||
    RISK_CUE_RE.test(v) ||
    PAYMENT_STATUS_CUE_RE.test(v)
  )
}

export function isPaymentCompletionClaim(text: string): boolean {
  const value = text || ''
  // Intent ("quiero pagar", "antes del envío") without a strong marker is never a completion claim.
  if (PAYMENT_INTENT_RE.test(value) && !STRONG_COMPLETION_RE.test(value) && !hasPaymentStatusClaim(value)) return false
  // "Envío exitoso" (a SINPE notification) — "envío" alone is shipping ("¿el envío va pagado?" is a question).
  if (/(?<![\p{L}])env[ií]o\s+exitos\p{L}*/iu.test(value)) return true
  const hasNoun = new RegExp(`(?<![\\p{L}])${COMPLETION_PAY_NOUN}(?![\\p{L}])`, 'iu').test(value)
  if (!hasNoun) return false
  if (/[✅✔☑]/u.test(value)) return true
  const question = /[?¿]/.test(value)
  // Right next to a payment noun it is a claim even inside a question ("sinpe pagado, ¿me pasás el número de pedido?").
  const cleaned = value.replace(LEADING_LISTO_RE, ' ').replace(COMPLETION_NOT_PAYMENT_RE, ' ')
  if (COMPLETION_NEAR_RE.test(cleaned)) return true
  if (question && INFO_QUESTION_CUE_RE.test(value)) return false
  if (!question && new RegExp(`(?<![\\p{L}])${COMPLETION_WORD}(?![\\p{L}])`, 'iu').test(value.replace(COMPLETION_NOT_PAYMENT_RE, ' '))) return true
  return false
}

/** A payment method a customer can name. */
export type PaymentChoiceMethod = 'sinpe' | 'transferencia' | 'tarjeta' | 'contra_entrega' | 'efectivo'

/**
 * Completion / sent / approved words (INT-115, shared with the choice gate): "Transferencia realizada", "tarjeta
 * aprobada", "Listo, transferencia", "Envío exitoso", ✅ — a claim, never a question about how to pay.
 */
export const PAYMENT_COMPLETION_RE =
  /(?<![\p{L}])(?:realizad\p{L}*|hech[oa]s?|echo|enviad\p{L}*|mandad\p{L}*|list[oa]s?|lsito|exitos\p{L}*|aprobad\p{L}*|pagad\p{L}*|cancelad\p{L}*|completad\p{L}*|transferid\p{L}*|depositad\p{L}*)(?![\p{L}])|[✅✔☑]/iu

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

const METHOD = String.raw`(sinpe(?: movil)?|transferencia(?: bancaria)?|tarjeta(?: de (?:credito|debito))?|contra ?entrega|al recibir(?:lo|la)?|efectivo)`
const LEAD = String.raw`(?:(?:prefiero pagar|prefiero|mejor|quiero pagar|voy a pagar|quisiera pagar|(?:te|le|les) pago|pago)\s+)?(?:(?:por|con|en)\s+)?(?:el\s+|la\s+)?`
const TAIL = String.raw`(?:\s*,?\s*(?:porfa|por favor|gracias|pls|esta bien|mejor|entonces|por la web|por la pagina|en la web|en la pagina)){0,3}[\s.!🙏😊🙌]*`
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
  if (word.startsWith('transferencia')) return 'transferencia'
  if (word.startsWith('tarjeta')) return 'tarjeta'
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

/** Loose method words (folded text) for the pending-question routes (N2 / N4). */
const LOOSE_METHODS: Array<[RegExp, PaymentChoiceMethod]> = [
  [/(?<![a-z])sinpe(?![a-z])/g, 'sinpe'],
  [/(?<![a-z])transfer[a-z]*/g, 'transferencia'],
  [/(?<![a-z])tarjeta(?![a-z])/g, 'tarjeta'],
  [/(?<![a-z])(?:contra ?entrega|(?:pago |pagar )?al recibir(?:lo|la)?)(?![a-z])/g, 'contra_entrega'],
  [/(?<![a-z])(?:efectivo|cash)(?![a-z])/g, 'efectivo'],
]
/** Status / dispute / problem words: a message with these is never routed as a choice (a person looks). */
const STATUS_DISPUTE_RE =
  /(?<![a-z])(?:cheque\p{L}*|chequ\p{L}*|verific\p{L}*|revis\p{L}*|avis\p{L}*|paso|camino|duplicad\p{L}*|doble|de mas|revers\p{L}*|anul\p{L}*|estafa|fraude|error|lleg\p{L}*|ver|vieron|deja|problema|falla\p{L}*|rechaz\p{L}*|devolu\p{L}*|reembols\p{L}*|cobr\p{L}*|ya)(?![a-z])/u

/**
 * N4: after the store's method question, a message that names exactly ONE method (loosely) with something else
 * ("Por sinpe y retiro en tienda", "Sinpe. Lo hago en la noche") goes to the model with that method chosen — but only
 * with no question mark, no digit / ₡ / ✅ 👍 💸 / ref, no claim, completion, status or dispute word. Pure.
 */
/**
 * Done / sent / status / dispute words in a message (word-bounded: "mandado", "ya", "ahí va", "revisá", "duplicado",
 * "estafa"…) — used where a loosely named method is carried across turns (sales-state). Pure.
 */
export function hasChoiceClaimOrStatusWord(text: string): boolean {
  const raw = (text || '').normalize('NFKC').replace(FORMAT_CHARS_RE, '')
  return CHOICE_CLAIM_WORD_RE.test(raw) || STATUS_DISPUTE_RE.test(foldChoice(raw))
}

export function pendingMethodMention(text: string): PaymentChoiceMethod | null {
  const raw = (text || '').normalize('NFKC').replace(FORMAT_CHARS_RE, '')
  if (!raw.trim() || raw.length > 120 || /[?¿]/.test(raw) || CHOICE_REJECT_RE.test(raw)) return null
  if (!isCueFreePaymentChoiceText(raw) || isPaymentCompletionClaim(raw) || PAYMENT_COMPLETION_RE.test(raw)) return null
  if (hasPaymentStatusClaim(raw) || NEGATION_RE.test(raw)) return null
  const t = foldChoice(raw)
  if (STATUS_DISPUTE_RE.test(t)) return null
  // SecureDog: ONLY an exact choice followed by an explicit logistics phrase ("y retiro en tienda", "con envío a
  // Heredia", "a domicilio", "para Cartago"); anything else falls through to the normal path.
  const m = LOGISTICS_CHOICE_RE.exec(t)
  return m ? methodOf(m[1]) : null
}

/** "no quiero contra entrega", "no tengo efectivo", "sinpe no", "mejor no por sinpe": never a choice. */
export const NEGATION_RE = /(?<![\p{L}])(?:no|nunca|tampoco|ni)(?![\p{L}])/iu
const PLACE = String.raw`[a-z]+(?: [a-z]+){0,2}`
const LOGISTICS = String.raw`(?:\s*,?\s*(?:y\s+)?(?:retiro en (?:la )?tienda|(?:con )?envio a ${PLACE}|a domicilio|para ${PLACE}))`
const LOGISTICS_CHOICE_RE = new RegExp(String.raw`^${LEAD}${METHOD}${LOGISTICS}${TAIL}$`, 'u')

/** Payment nouns the status lexicon needs nearby (pago also covers "le pago"). */
const STATUS_PAY_NOUN_RE = /(?<![\p{L}])(?:sinpe|transfer\p{L}*|pag\p{L}*|dep[oó]sit\p{L}*|plata|dinero|tarjeta|comprobante|monto)(?![\p{L}])/iu
/** Status / claim wording (SecureDog INT-114 reopened); checked only with a payment noun in the message. */
const STATUS_CLAIM_RE = new RegExp(
  [
    String.raw`verifi[cq]\p{L}*`,
    String.raw`(?:pag|mand|envi|deposit|transfiri|pas)ó|hizo`,
    String.raw`sali[oó]|se\s+fue|cay[oó]|entr[oó]`,
    String.raw`ayer|anoche|hoy\s+en\s+la\s+ma[nñ]ana|esta\s+ma[nñ]ana|a\s+las\s+(?:\d|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)|hace\s+(?:un\s+|una\s+)?(?:rato|momento|ratito|ratico)`,
    String.raw`ah[ií]\s+(?:le\s+|te\s+|les\s+)?va|ah[ií]\s+van`,
    String.raw`me\s+avisa\p{L}*`,
  ]
    .map((p) => `(?:${p})`)
    .join('|'),
  'iu',
)
/** Only in a message with no question: "desde la cuenta", "al número", "a nombre de", "OK", "completo", "efectuado". */
const STATUS_CLAIM_NO_QUESTION_RE =
  /(?<![\p{L}])(?:desde\s+la\s+cuenta|al\s+n[uú]mero|a\s+nombre\s+de|ok|okay|okey|completo|efectuad\p{L}*|realizad\p{L}*|exitos\p{L}*)(?![\p{L}])/iu

/** A payment noun with status / claim wording around it (word-bounded). Pure. */
export function hasPaymentStatusClaim(text: string): boolean {
  const value = stripFormatChars((text || '').normalize('NFKC'))
  if (!STATUS_PAY_NOUN_RE.test(value)) return false
  if (new RegExp(`(?<![\\p{L}])(?:${STATUS_CLAIM_RE.source})(?![\\p{L}])`, 'iu').test(value)) return true
  return !/[?¿]/.test(value) && STATUS_CLAIM_NO_QUESTION_RE.test(value)
}

/**
 * The method a message picks when it is SHAPED like a choice (paymentChoiceGrammar); `allowAsk` also accepts the strict
 * detail-ask forms. Also requires no claim / confirm / dispute cue (belt and braces). Pure.
 */
export function paymentChoiceShape(text: string, opts: { allowAsk?: boolean } = {}): PaymentChoiceMethod | null {
  // The whole-message allowlist grammar is the gate (its tail words — "está bien", "gracias" — are not claim cues).
  const g = paymentChoiceGrammar(text)
  return g && (opts.allowAsk || !g.ask) ? g.method : null
}

/** notifyHandoff reason code when a payment message goes to a person: 'complaint' (refund / dispute) or 'payment'. */
export function paymentHandoffReason(text: string): 'payment' | 'complaint' {
  const value = text || ''
  if (RISK_CUE_RE.test(value) || (REFUND_RE.test(value) && !isReturnPolicyQuestion(value))) return 'complaint'
  return 'payment'
}
