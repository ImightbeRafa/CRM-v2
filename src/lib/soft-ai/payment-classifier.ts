/**
 * Single deterministic payment classifier for the Soft Agent Layer.
 * Proof / confirmation / risk and ambiguous payment text stay human.
 * Information questions are payment_info_safe only when the cue is clear.
 */

import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'

export type PaymentClassification = 'non_payment' | 'payment_info_safe' | 'payment_proof_or_risk'

const PROOF_CUE_RE =
  // "ya te/les/lo pagué", "listo, ya lo pagué", "te mandé el sinpe" (accent-safe start: JS \b misses after á/é).
  // SecureDog wave D r2 #7: two pronouns ("ya te la mandé", "ya se lo pasé") and a "Pagado." sentence before a question.
  /(?<![\p{L}\p{N}_])(ya\s+(?:((le|te|les|lo|la|se)\s+){0,2}(pagu[eé]|hice|mand[eé]|transfer[ií]|deposit[eé])|((le|te|les|lo|la|se)\s+){1,2}(?:pas[eé]|envi[eé]|realic[eé]|di)(?=[ \t]*(?:$|[\n.!,?¿✅👍]|(?:la\s+plata|el\s+dinero|el\s+sinpe|el\s+pago|la\s+mitad|el\s+resto|la\s+transferencia|el\s+dep[oó]sito)(?![\p{L}]))))(?![\p{L}])|(?:(?:te|le|les|se)\s+(?:lo|la)\s+(?:envi[eé]|mand[eé]|pas[eé])\s+(?:hace\s+(?:un\s+)?rato|ahorita|hace\s+\p{L}+\s+minutos)|ahorita\s+(?:te|le|les|se)\s+(?:lo\s+|la\s+)?(?:pas[eé]|mand[eé]|envi[eé])(?=[ \t]*(?:$|[\n.!,?¿]))|(?:te|le|les|se)\s+(?:lo|la)\s+acabo\s+de\s+(?:mandar|enviar|pasar|depositar|transferir)|acabo\s+de\s+(?:pagar|transferir|depositar|hacer\s+el\s+(?:sinpe|pago|dep[oó]sito)))(?![\p{L}])|(?:^|(?<=[\n.!,]))[ \t]*pagad[oa][ \t]*[!.✅👍]*[ \t]*(?=$|[\n.!?¿])|comprobante|adjunto|captura|pantallazo|(le|te|les)\s+(envi[eé]|mand[eé])\s+(el\s+(sinpe|pago|comprobante)|la\s+plata|el\s+dinero)|pago\s+(realizado|hecho|listo)|listo\s+el\s+(pago|sinpe)|(ya\s+)?(est[aá]|qued[oó])\s+pagad[oa]|^\s*pagad[oa]\s*[!.✅👍]*\s*$|ref(?:erencia)?\s*\d)/iu

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
      String.raw`(?<![\p{L}])(?:mi|mis|su|sus)\s+(?!(?:forma|m[eé]todo|pago|tarjeta|cuenta|pedido|n[uú]mero|whatsapp|wasap|p[aá]gina|web|link|enlace|tienda|local|correo|casa|trabajo|parte|siguiente|primer|[uú]ltimo|pr[oó]xim\p{L}*|informaci[oó]n|mensajer\p{L}*|orden|compra|paquete|direcci[oó]n|ubicaci[oó]n)(?![\p{L}]))\p{L}{3,}\s+(?:(?:ya\s+)?(?:se\s+)?(?:le\s+|les\s+|te\s+|lo\s+|la\s+|me\s+)?(?:pag|deposit|transfiri|abon|cancel|sinpe|sinpi)[oó](?![\p{L}])|ya\s+(?:se\s+)?(?:le\s+|les\s+|te\s+|lo\s+|la\s+|me\s+)?(?:mand|pas|envi)[oó](?![\p{L}])|(?:se\s+)?(?:lo|la|les?)\s+(?:mand|pas|envi)ó(?![\p{L}])|(?:se\s+)?(?:le\s+|les\s+|te\s+|lo\s+|la\s+|me\s+)?(?:mand|pas|envi)[oó]\s+(?:la\s+|el\s+|los\s+|las\s+|una\s+|un\s+)?(?:plata|platica|dinero|sinpe|simpe|pago|mitad|resto|adelanto|abono|transferencia|dep[oó]sito|todo|₡\s?[\d.,]*\d|\d{1,3}(?:[.,]\d{3})+(?![\d-])|\d+\s*(?:mil|k|colones|rojos)(?![\p{L}])|(?<![\d-])\d{4,6}(?![\d-])))`,
      // Object first: "la otra la cancelo mi cuñado", "lo pago mi esposo".
      String.raw`(?:lo|la|los|las)\s+(?:pag|deposit|transfiri|abon|cancel|sinpe|sinpi)[oó]\s+(?:(?:mi|su|tu)\s+|(?:el|la)\s+(?!(?:d[ií]a|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|semana|quincena|pr[oó]xim\p{L}*|otr[oa]|mism[oa]|fin|mes|noche|tarde|ma[nñ]ana)(?![\p{L}])))\p{L}{3,}`,
      // "les acabo de pasar los 20.000", "le acabo de enviar ₡20.000", "le hice el simpe", "ya fue pagado", "todo pagado".
      String.raw`acabo\s+de\s+(?:depositar|transferir|sinpear|tirar)|acabo\s+de\s+(?:pasar|enviar|mandar)(?:l[eo]s?|te)?(?:\s+\p{L}+){0,2}?\s+(?:la\s+|el\s+|los\s+|las\s+|una\s+|un\s+)?(?:plata|platica|dinero|sinpe|simpe|pago|mitad|resto|adelanto|abono|transferencia|dep[oó]sito|todo|₡\s?[\d.,]*\d|\d{1,3}(?:[.,]\d{3})+(?![\d-])|\d+\s*(?:mil|k|colones|rojos)(?![\p{L}])|(?<![\d-])\d{4,6}(?![\d-]))|(?:le|les|te)\s+hice\s+(?:el|un)\s+(?:sinpe|simpe|pago|dep[oó]sito)|(?:ya\s+fue|todo|est[aá])\s+pagad[oa]|i\s+already\s+paid|already\s+paid|ya\s+les\s+tir[eé]`,
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
const GREETING = String.raw`hol+a+|holi|holis|pura\s+vida|upe|diay|mae|bueno|va|ah\s+ok|ah\s+bueno|buenas\s+(?:tardes|noches)|buenos\s+d[ií]as|buen\s+d[ií]a|buenas|hey|saludos|disculpe|disculp[aá]|una\s+consulta|consulta|(?:muchas\s+)?gracias|ok|okay|okey|perfecto|genial|excelente|s[uú]per|dale|claro|s[ií]|por\s+favor|porfa`
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
  // Rafael 2026-10-27 (live): "Qué costó tiene y como lo pudo pedir y pagar al llegar con tarjeta" (no "?") was
  // a payment claim because of "costó". In a sentence that opens with a question word, only a payment verb counts.
  for (const sentence of s.split(/(?<=[.!?¿¡\n])/u)) {
    const asks = INTERROGATIVE_LEAD_RE.test(sentence.replace(/^[\s¿¡.,!…]+/u, '').replace(LEADING_GREETING_RE, ''))
    for (const m of sentence.matchAll(/\p{L}+/gu)) {
      const w = m[0]
      const lw = w.toLowerCase()
      if (!/[éíó]$/u.test(lw) || ACCENT_OK.has(lw)) continue
      if ((m.index ?? 0) > 0 && /^\p{Lu}/u.test(w)) continue
      if (/r[éá]$/u.test(lw) && !PAST_RE_WORDS.has(lw)) continue
      if (asks && !PAY_VERB_STEM_RE.test(lw)) continue
      return true
    }
  }
  return false
}

/** A sentence that opens like a question even without "?" ("Qué costó tiene…", "como lo puedo pedir…"). */
const INTERROGATIVE_LEAD_RE =
  /^(?:y\s+)?(?:qu[eé]\s+(?:cost\p{L}*|precio|vale|valor|sale)|c[oó]mo|cu[aá]nto\p{L}*|cu[aá]ndo|cu[aá]l\p{L}*|d[oó]nde|puedo|podr[ií]a|se\s+puede|pueden|aceptan|reciben|tienen|ten[eé]s|tienes|hay)(?![\p{L}])/iu
/** Accented past forms that are still a payment act inside a question ("¿cómo hago si ya pagué?"). */
const PAY_VERB_STEM_RE =
  /^(?:pag|cancel|abon|deposit|transfer|transfir|sinp|mand|envi|pas|tir|gir|hic|hiz|di|d[ií]|cubr|liquid|complet|adelant)/u

/** A payment noun / verb: a STATEMENT carrying one ("Está pago", "La plata está") is never plain context. */
// SecureDog round 6: also "doing" verbs and amounts — "Le mande.", "Mi esposo se encargo.", "Se lo dio al mensajero.",
// "Le pase 20.000." are not plain context.
const PAY_STATEMENT_RE =
  /(?<![\p{L}])(?:pag\p{L}*|plata|platica|dinero|comprobante\p{L}*|sinpe\p{L}*|sinpi\p{L}*|transfer\p{L}*|transfi\p{L}*|dep[oó]sit\p{L}*|tarjeta\p{L}*|abon\p{L}*|cancel\p{L}*|cobr\p{L}*|cargo\p{L}*|recibo|monto|saldo|adelanto|resto|mitad|link|enlace|mand\p{L}*|pas[eéoó]|pasamos|pasaron|envi[eéoó]|enviamos|enviaron|encarg\p{L}*|di[oó]?|dimos|dieron|entreg\p{L}*|hic\p{L}*|hech\p{L}*|resolv\p{L}*|arregl\p{L}*|lleg\p{L}*|ca[ií]\p{L}*|cae|caer\p{L}*|todo|₡)(?![\p{L}])|(?<![\d-])\d{1,3}(?:[.,]\d{3})+(?![\d-])|\d+\s*(?:mil|k|rojos|colones)(?![\p{L}])/iu
/** A payment noun or an amount (the per-sentence statement rule; never a bare "mandé / pasé / llegó"). */
const PAY_NOUN_RE =
  /(?<![\p{L}])(?:pag\p{L}*|plata|platica|dinero|sinpe\p{L}*|sinpi\p{L}*|transfer\p{L}*|transfi\p{L}*|dep[oó]sit\p{L}*|comprobante\p{L}*|abon\p{L}*|monto|mitad|resto|adelanto)(?![\p{L}])|₡|(?<![\d-])\d{1,3}(?:[.,]\d{3})+(?![\d-])|\d+\s*(?:mil|rojos|colones|k)(?![\p{L}])/iu
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

/**
 * SecureDog round 8 (release gate): someone else's paying act riding inside an ask sentence ("Quiero pagar el resto, Juan pago
 * la mitad", "¿Me pasás el número, que mi esposo puso la mitad?"). An unaccented -o paying verb is the third-person past
 * unless a first-person / question frame sits right before it ("les pago", "cómo pago", "lo pago") or it is the noun
 * ("el pago"); mandó / pasó / envió / puso / dio / hizo + a money word are always someone's act.
 */
const PAY_O_RE = /(?<![\p{L}])(?:pag|cancel|deposit|abon|sinpe|sinpi|adelant|cubri|complet|liquid|mand|pas|envi|gir|tir)[oó](?![\p{L}])|(?<![\p{L}])(?:puso|dio|hizo)(?![\p{L}])/giu
const SENT_O_RE = /(?<![\p{L}])(?<!(?:te|le|les|se\s+l[oa]s?|yo)\s+)(?:mand|pas|envi|gir|tir)[oó]\s+(?:(?:la|el|los|las|lo|una|un|su|mi)\s+)?(?:plata|platica|dinero|sinpe|mitad|resto|pago|adelanto|parte|transferencia|dep[oó]sito|todo|otra|\d)/iu
const DID_RE = /(?<![\p{L}])(?:puso|pusieron|pusimos|dio|di[oó]|hizo|cubri[oó]|liquid[oó])\s+(?:(?:la|el|los|las|lo|una|un|su|mi)\s+)?(?:plata|platica|dinero|sinpe|mitad|resto|pago|adelanto|parte|transferencia|dep[oó]sito|todo|otra|\d)/iu
const FRAME_BEFORE_RE = /(?:^|[\s¿¡,.!?])(?:yo|te|le|les|lo|la|los|las|aceptan|reciben|hacen|tienen|hay|de|con|por|para|sin|en|a|otro|otra|mismo|cualquier|cu[aá]l|cu[aá]nto|ning[uú]n|alg[uú]n|nuestro|tus|sus|mis|c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]|si|el|del|al|un|mi|tu|su|este|ese|primer|cada|y|o|mejor|hoy|ma[nñ]ana|ahorita|ahora|despu[eé]s|luego|tambi[eé]n|solo|s[oó]lo|entonces|bueno|ok|dale|listo)\s*$/iu
/** A balance only the store knows — "el resto", "la mitad", "lo que falta", "mi parte", "el saldo". */
const PARTIAL_STATE_RE = /(?<![\p{L}])(?:mitad|resto|saldo|adelanto|lo\s+que\s+(?:falta|queda|resta)|la\s+otra\s+(?:parte|mitad)|(?:mi|su|tu)\s+parte|faltante|debiendo|cubiert[oa]|saldad[oa])(?![\p{L}])/iu
const PERSON_WORD_RE = /^(?:esposo|esposa|marido|se[nñ]or|se[nñ]ora|do[nñ]a|don|muchach[oa]|cu[nñ]ad[oa]|vecin[oa]|pareja|ex|novi[oa]|suegr[oa]|abuel[oa]|amig[oa]|prim[oa]|t[ií][oa]|sobrin[oa]|niet[oa]|hij[oa]|herman[oa]|mam[aá]|pap[aá]|mami|papi|jefe|jefa|compa\p{L}*|él|ella|ellos|ellas|alguien|chamac[oa]|carajill[oa])$/iu
const NOT_A_NAME_RE = /^(?:Sinpe|Tarjeta|Contra|Link|Whats\p{L}*|Bac|Bcr|Bn|Correos|Gracias|Hola|Ok|Okey|Sí|Si|Bueno|Dale|Perfecto|Listo|Yo)$/u
export function hasFreePayAct(value: string): boolean {
  const v = (value || '').normalize('NFKC')
  if (SENT_O_RE.test(v) || DID_RE.test(v)) return true
  for (const m of v.matchAll(PAY_O_RE)) {
    const idx = m.index ?? 0
    const head = v.slice(0, idx)
    const prev = head.slice(Math.max(0, head.length - 24))
    if (/(?:^|[.!?¿¡\n,;:])\s*$/u.test(head)) continue
    if (!/ó$/u.test(m[0])) {
      const subj = prev.replace(/(?:\s+(?:ya|se|le|les|te|lo|la|los|las|me))+\s*$/iu, ' ')
      const word = (subj.match(/(\p{L}+)\s*$/u) || [])[1] || ''
      const sentenceStart = /(?:^|[.!?¿¡\n])\s*\p{L}+\s*$/u.test(head.slice(0, head.length - (prev.length - subj.length)))
      const named = /^\p{Lu}\p{Ll}+$/u.test(word) && !sentenceStart && !NOT_A_NAME_RE.test(word)
      if (named || PERSON_WORD_RE.test(word)) return true
      if (/(?:^|\s)(?:lo|la|los|las)\s*$/iu.test(prev) && /^\s+(?:\p{Lu}\p{Ll}+|(?:mi|su|tu|el|la)\s+\p{L}{3,})(?![\p{L}])/u.test(v.slice(idx + m[0].length))) return true
      continue
    }
    if (FRAME_BEFORE_RE.test(prev)) {
      const after = v.slice(idx + m[0].length)
      if (/(?:^|\s)(?:lo|la|los|las)\s*$/iu.test(prev) && /^\s+(?:\p{Lu}\p{Ll}+|(?:mi|su|tu|el|la)\s+\p{L}{3,})(?![\p{L}])/u.test(after)) return true
      continue
    }
    return true
  }
  return false
}

/** An agent-side exit only for a plain ask with no third-person paying act and no balance word; else → a person. */
function plainOr(value: string, cls: PaymentClassification): PaymentClassification {
  return isPlainAskMessage(value) && !hasFreePayAct(value) && !PARTIAL_STATE_RE.test(value) ? cls : 'payment_proof_or_risk'
}

/** Refund wording (INT-81): goes to a person unless it is a plain return-policy question. */
const REFUND_RE = /(?<![\p{L}])(devol\p{L}*|devuelv\p{L}*|regres(en|e|ar|ame|enme)\s+(la\s+plata|el\s+dinero|mi\s+plata|mi\s+dinero|lo\s+que\s+(di|pagu[eé])))/iu
// A greeting may come first ("Hola, ¿puedo devolverlo si no me queda?"); only the FIRST sentence is the question.
const RETURN_POLICY_QUESTION_RE =
  /^\s*((hola|buenas|buenos\s+d[ií]as|buenas\s+(tardes|noches)|disculpe|una\s+consulta|consulta)[\s,.!]*)?¿?\s*(puedo|se\s+puede|pueden|c[oó]mo|hacen|aceptan|tienen|hay|(?:cu[aá]l\s+es|qu[eé])\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:pol[ií]tica|plazo|garant[ií]a|condiciones|proceso\s+(?:de|para)))(?![\p{L}])[^.!?\n]*(devol\p{L}*|devuelv\p{L}*|cambi\p{L}*)/iu
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
 * Sleeping exam C2 (2026-10-18): a bare "confirm" ask with nothing about money — "Para confirmar el pedido!?",
 * "Quisiera confirmar el pedido", "Pura vida, me confirmás entonces?". Every other word must be on this short list
 * (greetings, "para / quisiera / me", the order itself), so nothing about a payment, a receipt or "lo recibieron" can
 * ride along. Only used when the chat has no payment yet (see confirmCueCounts).
 */
// Ask forms only (Verifier r1 #6): never the past / participle ("me confirmaron", "pedido confirmado") — those stay claims.
const BARE_CONFIRM_VERB_RE =
  /(?<![\p{L}])(?:me\s+|nos\s+)?(?:confirmar(?:me|nos|lo|la)?|confirm[aá]s|confirma(?:me|nos|lo|la)?|conf[ií]rma(?:me|nos|lo|la|melo)|confirmen(?:me|nos)?|confirman|confirme|confirmar[ií]a[sn]?)(?![\p{L}])/iu
const BARE_CONFIRM_FILLER = new Set(
  (
    'hola holi buenas buen dia dias tardes noches pura vida disculpe disculpa disculpá una consulta ok okay dale bueno perfecto ' +
    'gracias muchas porfa por favor para quisiera quiero queria quería deseo me gustaria gustaría podes podés podrias podrías puede ' +
    'pueden podria podría lo la le me nos el mi la los mis entonces si sí y e de del pedido orden compra porfis'
  ).split(/\s+/),
)
export function isBareOrderConfirmAsk(text: string): boolean {
  const value = stripFormatChars((text || '').normalize('NFKC')).trim()
  if (!value || value.length > 120) return false
  // SecureDog r1 INT-160: an allowlist of characters — letters, spaces, plain punctuation and the friendly emoji only
  // (no 🧾 💰 💳 💵 🏦 ✓ 👌 📷, no digits or money signs can ride along).
  if (!/^[\p{L}\s¿?¡!.,…]+$/u.test(value.replace(FRIENDLY_RE, ' '))) return false
  if (!BARE_CONFIRM_VERB_RE.test(value)) return false
  if (
    PAYMENT_RE.test(value) ||
    PAYMENT_STATUS_CUE_RE.test(value) ||
    PROOF_CUE_RE.test(value) ||
    hasPaymentClaimCue(value) ||
    CONFIRM_PAYMENT_RE.test(value) ||
    RISK_CUE_RE.test(value) ||
    SENT_AMOUNT_CLAIM_RE.test(value) ||
    isPaymentCompletionClaim(value) ||
    /(?<![\p{L}])(?:revis\p{L}*|ya)(?![\p{L}])/iu.test(value)
  ) {
    return false
  }
  const rest = value
    .replace(new RegExp(BARE_CONFIRM_VERB_RE.source, 'giu'), ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
  return rest.every((w) => BARE_CONFIRM_FILLER.has(w))
}

/**
 * SecureDog r1 INT-159: words that hint at a payment's STATE with no payment noun — "¿les llegó?", "lo recibieron?",
 * "ya", "listo", "ahí va", "revisen". A burst with one of these never gets the bare-ask relaxation.
 */
const PAYMENT_STATUS_HINT_RE =
  /(?<![\p{L}])(?:ya|lleg[oó]|llegaron|recib\p{L}*|entr[oó]|cay[oó]|qued[oó]|list[oa]|hech[oa]|enviad[oa]|mandad[oa]|pagad[oa]|revis\p{L}*|verific\p{L}*|ah[ií]\s+(?:les|le|te)\s+va|ah[ií]\s+va|acredit\p{L}*|reflej\p{L}*|aparec\p{L}*)(?![\p{L}])|[✅✔☑✓👌🧾💰💳💵🏦📷📸]/iu
export function hasPaymentStatusHint(text: string): boolean {
  return PAYMENT_STATUS_HINT_RE.test(stripFormatChars((text || '').normalize('NFKC')))
}

/**
 * SecureDog r2 (INT-159 / INT-161): a courtesy-only bubble — greetings, thanks, "ok / dale / claro / sí", plain
 * punctuation and the friendly emoji only (never 👍 💸 🤑, never "listo" / "todo bien"). Pure.
 */
const COURTESY_ONLY_RE = new RegExp(String.raw`^(?:[\s,.!¡¿?…]|(?:${GREETING})(?![\p{L}\d]))+$`, 'iu')
export function isCourtesyText(text: string): boolean {
  const value = stripFormatChars((text || '').normalize('NFKC')).replace(FRIENDLY_RE, ' ').trim()
  return value.length > 0 && value.length <= 60 && COURTESY_ONLY_RE.test(value)
}

/** The customer used a confirm / review verb (any form): replies to it get the payment-status backstop (INT-159). */
export function mentionsConfirmVerb(text: string): boolean {
  const gapped = invisibleAsGap(text)
  return CONFIRM_CUE_RE.test(stripFormatChars((text || '').normalize('NFKC'))) || (gapped !== null && CONFIRM_CUE_RE.test(stripFormatChars(gapped)))
}

/**
 * SecureDog INT-158 M1: a payment's state in English / Portuguese / French ("Did you receive my payment?", "Payment
 * done", "I paid yesterday", "Here is my transfer receipt", "pagamento feito", "paiement envoyé"). The prompt answers in
 * Spanish only, so any of these goes to a person. Both readings (invisible characters as gaps too).
 * SecureDog wave D r2: deny by default — ANY English / PT / FR payment or money word (or "did it arrive / have you got
 * it"), not a phrase list. An English "How can I pay?" goes to a person too (the agent answers in Spanish only).
 */
// Verifier r3 #3: no bare "cash / done / pay / money / transfer / charge" (product names, "¿Aceptan cash?", Apple Pay):
// those only in a state shape ("money sent", "done, gracias", "charged me twice").
const FOREIGN_PAYMENT_STATE_RE =
  /(?<![\p{L}])(?:paid|paying|payment|payments|transferred|wired|deposited|receipt|receipts|refund\p{L}*|pix|pagamento|pagamentos|paguei|pagou|depositei|pago\s+feito|virement|paiement|pay[eé]e?|re[cç]u|(?:money|cash|transfer|sinpe|plata|pago)\s+(?:sent|done|arrived)|(?:sent|done)\s+(?:the\s+|el\s+|la\s+|my\s+)?(?:money|cash|transfer|sinpe|plata|pago)|charged\s+(?:me|twice)|(?:did|has|have)\s+(?:it|you|u)\s+(?:arrive[ds]?|got|get|gotten|receive[ds]?|seen|see)|(?:did|has)\s+(?:the|my)\s+(?:money|transfer|deposit|sinpe)\s+(?:arrive[ds]?|go\s+through|come\s+through)|went\s+through|recebe(?:u|ram|ste)|recebido|(?:did|has)\s+it\s+(?:go(?:ne)?\s+through|work(?:ed)?)|(?:is|was)\s+it\s+(?:there|received)|(?:you\s+)?got\s+it\s*\?|arrived\s*\?|did\s+you\s+guys\s+get\s+it|(?:can\s+(?:u|you)\s+)?confirm\s*(?:pls|please|plz)?\s*\?|confirm\s+(?:pls|please|plz)|all\s+good\s*\?|check\s+your\s+account|(?:j[aá]\s+)?(?:mandei|enviei|transferi)|comprovante|dinheiro|chegou\s*\?|caiu\s*\?|c['’]est\s+(?:fait|r[eé]gl[eé])|j['’]ai\s+(?:envoy[eé]|r[eé]gl[eé]|pay[eé]|fait\s+le\s+virement))(?![\p{L}])|^[\s\p{P}]*(?:(?:ok|okay|listo|ya|ready)[\s\p{P}]+)?(?:sent|done)(?:[\s\p{P}]+(?:gracias|thanks|thx|ty))?[\s\p{P}\p{Extended_Pictographic}]*$/iu
/**
 * SecureDog wave D r4 (M1, structural): a customer bubble WRITTEN in English / PT / FR (more of its words are foreign
 * than Spanish, links and Title Case names aside) that carries a state word ("I sent it", "Just sent", "It's done",
 * "Transfer is done", "Já foi", "Depositei", "Je vous ai envoyé l'argent") is a payment-state message — no phrase list.
 */
const FOREIGN_CUSTOMER_WORD_RE =
  /(?<![\p{L}])(?:i|i'm|it|it's|its|is|was|just|already|all|the|my|you|your|we|made|have|has|did|sent|done|transfer|transferred|money|deposit|deposited|paid|payment|received|j[aá]|foi|fiz|fez|depositei|transferi|transferência|dinheiro|enviei|mandei|je|vous|ai|envoy[eé]|argent|fait|virement|pay[eé])(?![\p{L}])/giu
const FOREIGN_STATE_WORD_RE =
  /(?<![\p{L}])(?:sent|done|transfer|transferred|money|deposit|deposited|paid|payment|received|foi|fiz|depositei|transferi|transferência|dinheiro|enviei|mandei|envoy[eé]|argent|fait|virement|pay[eé])(?![\p{L}])/iu
const SPANISH_CUSTOMER_WORD_RE =
  /(?<![\p{L}])(?:de|la|el|que|y|en|los|las|un|una|por|con|para|es|lo|le|me|mi|te|ya|s[ií]|no|hola|gracias|quiero|tienen|cu[aá]nto|est[aá]|pago|env[ií]o|precio)(?![\p{L}])/giu
function readsAsForeignStateStatement(text: string): boolean {
  const words = (text || '').replace(/\S*(?:https?:\/\/|www\.)\S*/giu, ' ').replace(/(?<![\p{L}])\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+/gu, ' ')
  if (!FOREIGN_STATE_WORD_RE.test(words)) return false
  // Verifier final: at least two foreign words ("Done patch?", "Papel transfer", "¿Son made in Korea?" are Spanish).
  const foreign = new Set((words.match(FOREIGN_CUSTOMER_WORD_RE) ?? []).map((w) => w.toLowerCase())).size
  return foreign >= 2 && foreign > (words.match(SPANISH_CUSTOMER_WORD_RE) ?? []).length
}

/** English / PT / FR payment-state wording in customer text (either reading). */
export function hasForeignPaymentState(text: string): boolean {
  const gapped = invisibleAsGap(text)
  const read = (t: string) => FOREIGN_PAYMENT_STATE_RE.test(t) || readsAsForeignStateStatement(t)
  return read(stripFormatChars((text || '').normalize('NFKC'))) || (gapped !== null && read(stripFormatChars(gapped)))
}

/**
 * SecureDog wave D r4 (INT-209, structural): a word that mixes Latin letters with another script, or uses IPA / small
 * capitals / dotless ı / Latin-extended look-alikes ("hıce", "Lօ", "ӏӏegó", "Lᴇs", "Pаid") — instead of growing a fold map.
 * Such a customer message goes to a person. Pure.
 */
const ODD_LATIN_RE = new RegExp(
  '[' +
    [[0x131, 0x131], [0x250, 0x2af], [0x1d00, 0x1dbf], [0xa730, 0xa7ff], [0xab30, 0xab6f]]
      .map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`)
      .join('') +
    ']',
  'u',
)
const LOOKALIKE_SCRIPT_RES = [
  /\p{Script=Latin}/u,
  /\p{Script=Cyrillic}/u,
  /\p{Script=Greek}/u,
  /\p{Script=Armenian}/u,
  /\p{Script=Cherokee}/u,
  /\p{Script=Georgian}/u,
  /\p{Script=Coptic}/u,
]
export function hasMixedScriptWord(text: string): boolean {
  // Verifier final: unit symbols are not look-alikes ("500µg", "10kΩ"; NFKC turns µ / Ω into Greek letters).
  const units = (text || '').normalize('NFKC').replace(/[μµ](?=[gmlsLVAFW])/gu, 'u').replace(/[ΩΩ]/gu, 'O')
  const words = units.match(/[\p{L}\p{M}]+/gu) ?? []
  const latinMessage = words.some((w) => /^[\p{Script=Latin}\p{M}]+$/u.test(w))
  for (const w of words) {
    if (ODD_LATIN_RE.test(w)) return true
    if (/\p{Script=Latin}/u.test(w) && /[^\p{Script=Latin}\p{M}]/u.test(w)) return true
    // SecureDog final (INT-209 residual): a word spelled entirely in look-alikes inside a Latin message ("Ya раցսе́"),
    // or one word mixing two other scripts ("ѕіոре").
    if (latinMessage && !/\p{Script=Latin}/u.test(w)) return true
    if (LOOKALIKE_SCRIPT_RES.filter((re) => re.test(w)).length >= 2) return true
    // Accent stuffing: a Latin word with two accented vowels ("págué") or a diacritic Spanish / Portuguese never uses
    // ("pạgué"). NFC so á / é count as one letter each.
    if (/\p{Script=Latin}/u.test(w)) {
      const nfc = w.normalize('NFC')
      // Spanish never puts two acute accents in one word (French "brûlée" / "Hélène" carry one acute at most).
      if ((nfc.match(/[áéíóúÁÉÍÓÚ]/gu) ?? []).length >= 2) return true
      // Latin-1 letters (Zoë, João, François, Crème) are names; Latin Extended diacritics (ạ, ǵ, ẹ) are not Spanish.
      if (/[^\p{ASCII}À-ÖØ-öø-ÿ]/u.test(nfc)) return true
    }
  }
  return false
}

/**
 * SecureDog wave D final (INT-206 statement form): a short customer bubble (≤ 4 words, no question) carrying a done /
 * payment word — "Listo", "Listo ✅", "Hecho", "Ya quedó", "Ahí va", "Ok listo", "ya pagúe". Only read after the store
 * already sent its payment details (inbound-decision paymentDetailsSent), where it means "I paid".
 */
const SHORT_DONE_WORD_RE =
  /(?<![\p{L}])(?:list[oa]|hecho|ya|qued[oó]|ah[ií]\s+va|ah[ií]\s+est[aá]|ready|enviad[oa]|mandad[oa]|pagad[oa]|pag\p{L}*|transfer\p{L}*|tranfer\p{L}*|deposit\p{L}*|sinpe|done|sent|paid)(?![\p{L}])|[✅✔☑]/iu
export function isShortDoneBubble(text: string): boolean {
  const v = stripFormatChars((text || '').normalize('NFKC'))
  if (!v.trim() || /[?¿]/u.test(v) || v.length > 60) return false
  // SecureDog final: courtesy words do not count toward the cap ("Listo, ya quedó todo gracias").
  const words = (v.match(/\p{L}+/gu) ?? []).filter((w) => !/^(?:gracias|muchas|mil|mae|pura|vida|porfa|ok|okey|bueno|todo)$/iu.test(w))
  return words.length <= 4 && SHORT_DONE_WORD_RE.test(v)
}

/**
 * A bare confirm / review verb stays a payment cue (SecureDog INT-93) — except a bare order-confirm ask in a chat where
 * nothing about paying happened yet (no payment details sent, no receipt photo, no payment words from the customer,
 * no web order): then it is an ordinary sales message.
 */
function confirmCueCounts(value: string, noPaymentYet: boolean): boolean {
  if (!CONFIRM_CUE_RE.test(value)) return false
  return !(noPaymentYet && isBareOrderConfirmAsk(value))
}

/**
 * Verifier round 10: an EARLIER message of a burst counts only for a real claim (a receipt, "ya pagué", a status, a
 * completion, a done-verb about money) — never the "payment word and no question" fallback, so "Sinpe" + "gracias"
 * after "¿Cómo preferís pagar?" or "No tengo sinpe" + "¿aceptan tarjeta?" stay answers.
 */
/**
 * Pura Sonrisa P4: two phrases that are never about paying the store — "(para) no pagar (el) envío" (the customer picks
 * it up) and a delivery person / the order arriving ("El Uber ya llegó", "Ya llegó el mensajero", "ya el paquete
 * llegó"). Blanked out before the checks, ONLY when the message names no payment noun ("Ya pagué, el Uber ya llegó"
 * stays a claim). Pure.
 */
const DELIVERY_SUBJECT = String.raw`(?:(?:el|la|mi)\s+)?(?:uber|didi|indriver|mensajer[oa]|motorizad[oa]|repartidor(?:a)?|chofer|taxi|paquete|pedido|encomienda|env[ií]o)`
const NO_PAY_SHIPPING_RE = /(?<![\p{L}])(?:para\s+)?no\s+pagar(?:\s+(?:el|lo\s+del))?\s+env[ií]o(?![\p{L}])/giu
const DELIVERY_ARRIVAL_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:${DELIVERY_SUBJECT}\s+ya\s+lleg[oó]|ya\s+lleg[oó]\s+${DELIVERY_SUBJECT}|ya\s+${DELIVERY_SUBJECT}\s+lleg[oó])(?![\p{L}])`,
  'giu',
)
/** Money / payment / done words (Verifier b3: cash to the courier — "le di los 15 mil", "le dejé el efectivo", "ya quedó"). */
const PAYMENT_NOUN_ANY_RE =
  /(?<![\p{L}])(?:sinpe|simpe|pag\p{L}*|plata|platica|dinero|efectivo|cash|transfer\p{L}*|dep[oó]sit\p{L}*|comprobante|monto|tarjeta|cuenta|cancel\p{L}*|abon\p{L}*|mil|rojos|colones|di|dimos|entregu[eé]|entregamos|dej[eé]|dejamos|listo|hecho|qued[oó]|ya\s+est[aá]|revis\p{L}*|confirm\p{L}*)(?![\p{L}])|[₡¢]|\d{3,}|[✅✔☑👍]/iu
export function maskNonPaymentPhrases(value: string): string {
  let out = value
  // "(para) no pagar (el) envío": blanked only when no money / done word is left ("Mejor lo retiro para no pagar envío").
  const noPay = out.replace(NO_PAY_SHIPPING_RE, ' ')
  if (noPay !== out && !PAYMENT_NOUN_ANY_RE.test(noPay) && !hasPaymentStatusHint(noPay)) out = noPay
  // A delivery person / the order arriving: blanked only when nothing but courtesy is left ("Ya llegó el Uber, gracias").
  // Verifier b3: "Ya llegó el mensajero, le di los 15 mil" is a cash-on-delivery claim and keeps its hand-off.
  const arrival = out.replace(DELIVERY_ARRIVAL_RE, ' ')
  if (arrival !== out && (!arrival.replace(FRIENDLY_RE, '').replace(/[\s,.!¡¿?…]+/gu, '') || isCourtesyText(arrival))) out = arrival
  return out
}

/**
 * Stripping invisible characters glues words ("ya<ZWSP>pague" → "yapague"), so customer text is also read with them as
 * a gap (line / paragraph separators as a line break). Every customer-text check reads both forms; either reading that
 * claims a payment counts (hand-off is the safe direction). Returns null when both readings are the same text.
 */
export function invisibleAsGap(text: string): string | null {
  const nfkc = (text || '').normalize('NFKC')
  const gapped = nfkc
    .replace(/[\p{Zl}\p{Zp}]/gu, '\n')
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu, (c) => (c === '\n' || c === '\t' || c === '\r' ? c : ' '))
    // SecureDog wave D r2 (INT-207): a visible blank that is not whitespace (U+2800 Braille blank, U+FFFC, symbols):
    // anything that is not a letter, number, punctuation, currency sign, emoji or whitespace is a gap too — combining
    // marks included (r3: U+16FE4; NFKC already composed Spanish accents).
    .replace(/[^\p{L}\p{N}\p{P}\p{Sc}\p{Extended_Pictographic}\p{Emoji_Modifier}\s]/gu, ' ')
    // SecureDog wave D r3 (INT-209): Cyrillic / Greek letters that look Latin ("Yа lе hicе еl sinpе") read as Latin.
    .replace(CUSTOMER_LOOKALIKE_RE, (ch) => CUSTOMER_LOOKALIKE[ch] ?? ch)
  return gapped === nfkc ? null : gapped
}
const CUSTOMER_LOOKALIKE: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', к: 'k', м: 'm', т: 't', в: 'b', н: 'h',
  А: 'A', Е: 'E', О: 'O', Р: 'P', С: 'C', Х: 'X', У: 'Y', І: 'I', Ј: 'J', Ѕ: 'S', К: 'K', М: 'M', Т: 'T', В: 'B', Н: 'H',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  ο: 'o', α: 'a', ε: 'e', ι: 'i', υ: 'u', ν: 'v', κ: 'k', ρ: 'p', τ: 't',
  // SecureDog final: palochka, п, г, ь, ԛ, ԝ and Armenian look-alikes (a message written entirely in them folds to Latin).
  ӏ: 'l', Ӏ: 'l', п: 'n', г: 'r', ь: 'b', ԛ: 'q', ԝ: 'w', օ: 'o', ս: 'u', ց: 'g', ո: 'n', հ: 'h', զ: 'q', ք: 'p', ա: 'w', Ս: 'U', Օ: 'O', Ԍ: 'G',
}
const CUSTOMER_LOOKALIKE_RE = new RegExp(`[${Object.keys(CUSTOMER_LOOKALIKE).join("")}]`, "gu")

export function hasHardPaymentClaim(text: string, opts: { noPaymentYet?: boolean } = {}): boolean {
  const gapped = invisibleAsGap(text)
  return (
    hardClaimIn(stripFormatChars((text || '').normalize('NFKC')), opts) ||
    (gapped !== null && hardClaimIn(stripFormatChars(gapped), opts)) ||
    hasForeignPaymentState(text) ||
    hasMixedScriptWord(text)
  )
}

function hardClaimIn(stripped: string, opts: { noPaymentYet?: boolean }): boolean {
  const value = maskNonPaymentPhrases(stripped)
  return (
    SENT_AMOUNT_CLAIM_RE.test(value) ||
    PROOF_CUE_RE.test(value) ||
    hasPaymentClaimCue(value) ||
    confirmCueCounts(value, opts.noPaymentYet === true) ||
    CONFIRM_PAYMENT_RE.test(value) ||
    RISK_CUE_RE.test(value) ||
    hasPaymentStatusClaim(value) ||
    isPaymentCompletionClaim(value) ||
    (!/\?/.test(value) && PAY_STATEMENT_RE.test(value) && hasPastOrDoneWord(value, false)) ||
    // SecureDog wave D r2 #7: also per sentence — one "?" elsewhere ("Ya se lo pasé, ¿me avisa?") does not excuse the rest.
    // Verifier r3 #1: per sentence it needs a real payment noun or an amount ("Le mandé un mensaje ayer" is not one).
    value.split(/(?<=[.!?\n])/u).some((seg) => !/\?/.test(seg) && PAY_NOUN_RE.test(seg) && hasPastOrDoneWord(seg, false))
  )
}

/* ---- SecureDog round 8 release gate: live-equivalence (D1 can never answer a payment message live hands off, unless it is a closed shape) ---- */
/** Live e2b9fd2c exits, verbatim: when one of these matches, live answers too and plainOr (stricter) is enough. */
const LIVE_COD_RE = /(?<![\p{L}])(contra\s?entrega|pag(o|ar)\s+(al\s+recibir|cuando\s+(lo\s+|la\s+|me\s+)?(recib|lleg))|pago\s+en\s+efectivo\s+al)/iu
const LIVE_PAYMENT_RE = /\b(sinpe|transferencia|pago|pagar|comprobante|ib[aá]n|cuenta\s*banc|deposit[oa]|efectivo\s*contra)\b/i
const LIVE_PAYMENT_QUESTION_RE = /(?<![\p{L}])((puedo|se\s+puede|pued[eo]n|aceptan|hay\s+que|tengo\s+que|debo)(\s+\p{L}+){0,2}\s+(pagar|pago|pagarles|pagarte)|(c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]\s+formas?\s+de)(\s+\p{L}+){0,2}\s+(pago|pagar|se\s+paga|pagos)|(reciben|tienen|aceptan|usan|trabajan\s+con)\s+(sinpe|transferencias?|tarjetas?|efectivo))(?![\p{L}])/iu
const LIVE_INFO_Q_RE = /(adelantad|anticipad|con\s+qu[eé]\s+banco|qu[eé]\s+bancos?|a\s+qu[eé]\s+(n[uú]mero|cuenta)|aceptan\s+(tarjetas?|sinpe|transferencias?|efectivo)|se\s+puede\s+pagar\s+con|formas?\s+de\s+pago|m[eé]todos?\s+de\s+pago|cu[aá]ndo\s+(se\s+)?paga|pago\s+al\s+recibir|pagar\s+al\s+recibir)/iu
function liveWouldAnswer(v: string): boolean {
  if (LIVE_COD_RE.test(v) || INFO_CUE_RE.test(v)) return true
  if (!LIVE_PAYMENT_RE.test(v)) return true
  if (LIVE_PAYMENT_QUESTION_RE.test(v)) return true
  return /[?¿]/.test(v) && LIVE_INFO_Q_RE.test(v) && !PAYMENT_STATUS_CUE_RE.test(v)
}
const C_METHOD = String.raw`(?:sinpe(?:\s+m[oó]vil)?|transferencia|tarjeta(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?|efectivo|link(?:\s+de\s+pago)?|contra\s*entrega)`
const C_WHEN = String.raw`(?:hoy|ma[nñ]ana|ahorita|ahora|m[aá]s\s+tarde|luego|en\s+un\s+rato|en\s+la\s+(?:ma[nñ]ana|tarde|noche)|hoy\s+en\s+la\s+(?:ma[nñ]ana|tarde|noche)|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|al\s+recibir(?:lo|la)?|cuando\s+(?:me\s+)?(?:llegue|lo\s+reciba|la\s+reciba))`
const C_WHAT = String.raw`(?:el\s+pedido|el\s+env[ií]o|todo|eso|el\s+combo|los\s+parches|el\s+parche|(?:los|las)\s+(?:dos|tres|\d))`
const C_HEAD = String.raw`(?:(?:te|le|les)\s+pago|pago|(?:quiero|quisiera|voy\s+a|vamos\s+a|prefiero|puedo|necesito|me\s+gustar[ií]a|tengo\s+que|hay\s+que)\s+pagar(?:te|le|les)?|(?:te|le|les)\s+pagar[ií]a|(?:ya\s+)?(?:lo\s+|la\s+)?(?:tengo|estoy)\s+list[oa]\s+para\s+pagar|dame\s+la\s+info(?:rmaci[oó]n)?\s+para\s+pagar)`
const C_INTENT_RE = new RegExp(String.raw`^(?:y\s+)?` + C_HEAD + String.raw`(?:\s+` + C_WHAT + String.raw`)?(?:\s+(?:por|con|en)\s+` + C_METHOD + String.raw`)?(?:\s+` + C_WHEN + String.raw`)?(?:\s+(?:por|con|en)\s+` + C_METHOD + String.raw`)?(?:\s*,?\s*(?:porfa|por\s+favor|gracias))?$`, 'iu')
const C_QUESTION_RE = /^(?:y\s+)?(?:(?:me\s+(?:pas[aá]s|pasa|pasan|das|da|dan|envi[aá]s|mand[aá]s|pod[eé]s\s+pasar))\s+(?:el\s+n[uú]mero|los\s+datos|la\s+cuenta|la\s+info(?:rmaci[oó]n)?)|cu[aá]l\s+es\s+(?:el\s+|la\s+)?(?:n[uú]mero|sinpe|cuenta|iban)|a\s+qu[eé]\s+(?:n[uú]mero|cuenta)|(?:c[oó]mo|cu[aá]ndo|d[oó]nde|por\s+d[oó]nde)\s+(?:les\s+|te\s+|le\s+|lo\s+)?(?:pago|pagamos|se\s+paga)|el\s+pago\s+tiene\s+que\s+estar\s+hecho\s+antes\s+del\s+env[ií]o|el\s+pedido\s+es\s+enviado\s+despu[eé]s\s+del\s+pago)(?:\s+(?:de|del|para)\s+(?:sinpe|pagar|el\s+pago|la\s+transferencia|el\s+env[ií]o|el\s+pedido))?(?:\s*,?\s*(?:porfa|por\s+favor))?$/iu
/** Every sentence is a greeting / thanks / "quiero comprar…", a closed intent, a closed payment question, a closed choice,
 *  or a product / order question with no payment word at all ("¿Me lo tienen listo para el sábado?"). */
function closedPaymentMessage(value: string): boolean {
  const v = clean(value).replace(LEADING_LISTO_RE, '')
  if (!v.trim() || v.length > 200) return false
  const raw = v.replace(/¿/gu, '\u0001¿').match(/[^.!?\n\u0001]+[.!?\n\u0001]*/gu) ?? []
  const segs = raw.map((x) => ({ q: /\?/u.test(x), t: x.replace(/^[\s¿¡,]+/u, '').replace(/[\s?!.,\u0001]+$/u, '').trim() })).filter((x) => x.t)
  return segs.length > 0 && segs.every(({ q, t }) => {
    const body = t.replace(LEADING_GREETING_RE, '')
    if (OK_PREFIX_RE.test(t) || C_INTENT_RE.test(body) || C_QUESTION_RE.test(body) || Boolean(paymentChoiceGrammar(body))) return true
    if (isPlainFutureSinpeQuestion(t + '?') || isPlainPaymentLinkQuestion(t + '?')) return true
    // SecureDog round 8 F1: the free question after a closed ask is an ORDER question only ("¿Me lo tienen listo para el
    // sábado?", "¿Cuándo me llega?") — "¿Tienen lo de Juan?" / "¿Les sale lo de mi esposo?" go to a person.
    return q && ORDER_QUESTION_RE.test(t) && !hasPastOrDoneWord(t, true)
  })
}
const ORDER_QUESTION_RE =
  /^(?:y\s+)?(?:(?:me\s+)?(?:lo|la|los|las)\s+(?:tienen|tendr[ií]an|pueden\s+tener)\s+list[oa]s?(?:\s+para\s+\p{L}+(?:\s+\p{L}+)?)?|cu[aá]ndo\s+(?:me\s+)?(?:llega|llegar[ií]a|sale|saldr[ií]a|lo\s+env[ií]an|me\s+lo\s+env[ií]an)|cu[aá]nto\s+(?:tarda|dura)\s+(?:en\s+llegar|el\s+env[ií]o)|hacen\s+env[ií]os?\s+a\s+\p{L}+(?:\s+\p{L}+)?|llega\s+a\s+\p{L}+(?:\s+\p{L}+)?)$/iu
/**
 * The agent-side exit (live-equivalence gate). Where live e2b9fd2c answers too, D1 answers a plain ask (isPlainAskMessage,
 * as before the round-8 guard) — never worse than live. Where live hands off, D1 answers only a closed message: every
 * sentence a greeting / "quiero comprar…", a closed intent, a closed payment question or choice, or a product question with
 * no payment word — so nothing ("…, Juan les deposito una parte") can ride along.
 */
const DEBT_RE = /(?<![\p{L}])(?:deb[oeí]\p{L}*|debiendo|falta\p{L}*|pendiente)(?![\p{L}])/iu
function agentExit(value: string, cls: PaymentClassification): PaymentClassification {
  if (liveWouldAnswer(value)) return isPlainAskMessage(value) ? cls : 'payment_proof_or_risk'
  return closedPaymentMessage(value) && !hasFreePayAct(value) && !PARTIAL_STATE_RE.test(value) && !DEBT_RE.test(value) ? cls : 'payment_proof_or_risk'
}
/* ---- end live-equivalence gate ---- */

// Verifier r2 #2: only "how does it work" verbs — never "va / queda / qué tal" ("¿Qué tal va el pago?" is a status).
const HOW_VERB = String.raw`c[oó]mo\s+(?:ser[ií]a|es|funciona|se\s+hace|se\s+maneja)`
const PAY_THE = String.raw`el\s+pago`
const SHIP_THE = String.raw`(?:el|la)\s+(?:env[ií]o|entrega)`
const HOW_PAY_SHIP_RE = new RegExp(
  String.raw`^(?:y\s+)?(?:` +
    String.raw`${HOW_VERB}\s+(?:${SHIP_THE}\s+y\s+)?${PAY_THE}(?:\s+y\s+${SHIP_THE})?` +
    String.raw`|${PAY_THE}(?:\s+y\s+${SHIP_THE})?\s+${HOW_VERB}` +
    String.raw`|${SHIP_THE}\s+y\s+${PAY_THE}\s+${HOW_VERB}` +
    String.raw`)\s*[?!.]*$`,
  'iu',
)
/** P4: a closed "how do shipping and payment work?" question, nothing else in the message. Pure. */
export function isHowPayShipQuestion(text: string): boolean {
  const v = clean(stripFormatChars(text || ''))
    .replace(/[¿¡]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_GREETING_RE, '')
    .trim()
  return v.length > 0 && v.length <= 80 && HOW_PAY_SHIP_RE.test(v)
}

/**
 * Prototipo shoppers (2026-10-18): closed pre-purchase questions that name a method — "¿Cómo hago para pedirlo y pagar
 * por SINPE?", "Me sirve SINPE, pero ¿cuánto sería con envío?". The WHOLE message (after a greeting) must be one of these
 * shapes; checked only after every claim check. Pure.
 */
const PRE_METHOD = String.raw`(?:sinpe(?:\s+m[oó]vil)?|simpe|transferencia|tarjeta|efectivo|contra\s?entrega)`
const PRE_PURCHASE_RE = new RegExp(
  String.raw`^(?:` +
    String.raw`c[oó]mo\s+(?:hago|le\s+hago|puedo\s+hacer)\s+para\s+(?:pedir|comprar|ordenar|encargar)(?:lo|la|los|las)?\s+y\s+pagar(?:lo|la)?\s+(?:por|con|en)\s+${PRE_METHOD}` +
    String.raw`|(?:me\s+sirve|prefiero|mejor|puedo\s+pagar\s+(?:por|con))\s+(?:por\s+|con\s+)?${PRE_METHOD}\s*,?\s*(?:pero\s+|y\s+)?cu[aá]nto\s+(?:ser[ií]a|es|queda|sale|saldr[ií]a|quedar[ií]a)\s+(?:con|el|con\s+el)\s+env[ií]o` +
    String.raw`)\s*[?!.]*$`,
  'iu',
)
export function isPrePurchaseMethodQuestion(text: string): boolean {
  const v = clean(stripFormatChars(text || ''))
    .replace(/[¿¡]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_GREETING_RE, '')
    .trim()
  return v.length > 0 && v.length <= 100 && PRE_PURCHASE_RE.test(v)
}

// Only bare ("¿Les llegó?", "¿Lo recibieron?") or with a payment noun — "¿Les llegó mercadería nueva?" is stock.
// Verifier r7 #1: never "nos" ("Nos llegó, gracias" = the customer got the order); "le" and "recibió" only as a question.
const PAY_NOUN_AFTER = String.raw`\s+(?:el|la|mi|lo)\s+(?:pago|sinpe|simpe|plata|dinero|platica|transferencia|dep[oó]sito|comprobante)`
const NARROW_STATUS_QUESTION_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:` +
    String.raw`(?:ya\s+)?(?:les|te)\s+(?:lleg|cay|entr)[oó](?:\s*(?:[?¿!.,…]|$)|${PAY_NOUN_AFTER})` +
    String.raw`|(?:ya\s+)?le\s+(?:lleg|cay|entr)[oó](?:${PAY_NOUN_AFTER})?\s*\?` +
    String.raw`|(?:ya\s+)?(?:lo|la)\s+recibieron(?:\s*(?:[?¿!.,…]|$)|${PAY_NOUN_AFTER})` +
    String.raw`|(?:ya\s+)?(?:lo|la)\s+recibi[oó](?:${PAY_NOUN_AFTER})?\s*\?` +
    String.raw`)`,
  'iu',
)

/**
 * Sales-agent exam 2026-10-19 (X08): "¿Qué es mejor, SINPE o tarjeta? No quiero dar mi tarjeta" handed off on the bare word
 * "tarjeta". A CLOSED card-info message — every sentence is one of these questions / reluctance phrases, no digit at all
 * (a pasted card number keeps the person path) and no past / done word — is answered by the agent with the payment
 * facts (web Tilopay or a person sends the link; never card numbers by chat). Pure.
 */
const CARD_INFO_SEG_RE = new RegExp(
  String.raw`^(?:y\s+|pero\s+|es\s+que\s+)?(?:` +
    String.raw`(?:qu[eé]|cu[aá]l)\s+(?:es\s+)?(?:me\s+conviene\s+|mejor|m[aá]s\s+seguro|recomend[aá]s|recomiendan)(?:\s+pagar)?,?\s+(?:con\s+|por\s+)?(?:el\s+)?sinpe(?:\s+m[oó]vil)?\s+o\s+(?:con\s+)?(?:la\s+)?tarjeta` +
    String.raw`|(?:yo\s+)?no\s+(?:quiero|quisiera|me\s+gusta|me\s+da\s+confianza)\s+(?:dar|pasar|mandar|poner)\s+(?:los\s+(?:datos|n[uú]meros)\s+de\s+)?(?:mi|la)\s+tarjeta(?:\s+por\s+(?:aqu[ií]|ac[aá]|(?:el\s+)?chat|whatsapp))?` +
    String.raw`|(?:es|ser[aá]|ser[ií]a)\s+seguro\s+pagar\s+con\s+(?:la\s+)?tarjeta(?:\s+en\s+la\s+(?:p[aá]gina|web))?` +
  String.raw`)$`,
  'iu',
)
export function isCardInfoMessage(text: string): boolean {
  const v = clean(stripFormatChars((text || '').normalize('NFKC')))
  if (!v.trim() || v.length > 200 || /\d/.test(v)) return false
  const segs = v
    .replace(/¿/gu, '\u0001¿')
    .split(/[.!?\n\u0001]+/u)
    .map((x) => x.replace(/^[\s¿¡,]+/u, '').replace(/[\s,]+$/u, '').replace(LEADING_GREETING_RE, '').trim())
    .filter(Boolean)
  return segs.length > 0 && segs.every((t) => CARD_INFO_SEG_RE.test(t) && !hasPastOrDoneWord(t, true))
}

/**
 * Lane C store exam 2026-10-22 (real chats): two closed BEFORE-paying questions went to a person —
 * "Que le pongo de detalle" (what to write in the SINPE note; the "¿ya pagó?" model check called it a claim) and
 * "Como es el método de pago?? se puede pagar cuando ya está acá el producto??" (cash on delivery; "ya está" read as a
 * done word). Each sentence must be WHOLE one of these shapes (anchored, no digit at all, ≤ 200 chars), so no claim can
 * ride along: a pasted card / SINPE number, "ya pagué", "le puse …" all fail the shape and keep the person path.
 */
const PAY_NOTE_FIELD = String.raw`(?:detalle|descripci[oó]n|motivo|concepto|nota|comentario|mensaje)`
const PAY_NOTE_OF = String.raw`(?:\s+(?:del|de\s+la|de|para\s+el|para\s+la)\s+(?:sinpe(?:\s+m[oó]vil)?|transferencia|pago|dep[oó]sito))?`
const COD_WHEN = String.raw`(?:ya\s+)?(?:est[eé]|est[aá]|llegue|me\s+llegue|lo\s+tenga|la\s+tenga|lo\s+reciba|la\s+reciba|me\s+lo\s+entreguen|me\s+lo\s+traigan)`
const COD_THING = String.raw`(?:\s+(?:el|mi)\s+(?:producto|pedido|paquete|arn[eé]s|env[ií]o))?`
const CLOSED_PAY_INFO_SEG_RE = new RegExp(
  // Lane C D2: "quisiera saber cómo sería el envío y el pago" — the same shapes after "quisiera / quiero saber".
  String.raw`^(?:y\s+|pero\s+|entonces\s+|ok\s+|oki?\s+|disculpe?\s+|perd[oó]n\s+)?(?:(?:quisiera|quiero|me\s+gustar[ií]a|necesito)\s+saber\s+)?(?:` +
    // what goes in the transfer note
    String.raw`(?:qu[eé]|que)\s+(?:le\s+|les\s+|te\s+)?(?:pongo|escribo|tengo\s+que\s+poner|debo\s+poner|hay\s+que\s+poner|pongo\s+yo|va)\s+(?:de|en\s+(?:el|la))\s+${PAY_NOTE_FIELD}${PAY_NOTE_OF}` +
    String.raw`|(?:en\s+(?:el|la)\s+)?${PAY_NOTE_FIELD}${PAY_NOTE_OF}\s+qu[eé]\s+(?:le\s+)?(?:pongo|escribo|va)` +
    // how do I pay
    String.raw`|(?:c[oó]mo|cu[aá]l)\s+(?:es|son|ser[ií]a|ser[ií]an)\s+(?:el|los|la|las)\s+(?:m[eé]todos?|formas?|medios?)\s+de\s+pago` +
    String.raw`|qu[eé]\s+(?:m[eé]todos?|formas?|medios?)\s+de\s+pago\s+(?:tienen|hay|aceptan|manejan|usan)` +
    String.raw`|c[oó]mo\s+(?:se\s+paga|(?:le\s+|les\s+)?pago|(?:les\s+|le\s+)?puedo\s+pagar|ser[ií]a\s+el\s+pago)` +
    // can I pay when it arrives (cash on delivery)
    String.raw`|(?:se\s+puede|puedo|podr[ií]a|ser[ií]a\s+posible|es\s+posible)\s+pagar(?:lo|la|le)?\s+(?:cuando|hasta\s+que)\s+${COD_WHEN}(?:\s+(?:ac[aá]|aqu[ií]|en\s+(?:mi\s+)?casa))?${COD_THING}` +
    String.raw`|(?:se\s+puede|puedo|podr[ií]a)\s+pagar(?:lo|la|le)?\s+(?:al\s+recibir(?:lo|la)?|contra\s*entrega|(?:en\s+efectivo\s+)?al\s+(?:recibir(?:lo|la)?|entregar(?:lo|la)?|llegar))${COD_THING}` +
    String.raw`|(?:tienen|manejan|hacen|aceptan)\s+(?:pago\s+)?contra\s*entrega` +
    // Lane C D2 (real store chats): the SINPE number, paying later, shipping + payment, card by chat
    String.raw`|(?:cu[aá]l|qu[eé])\s+(?:ser[ií]a|es)\s+el\s+n[uú]mero\s+(?:para|de|del)\s+(?:hacer(?:te|le|les)?\s+(?:un|el)\s+)?sinpe(?:\s+m[oó]vil)?` +
    String.raw`|a\s+qu[eé]\s+n[uú]mero\s+(?:te\s+|le\s+|les\s+)?(?:hago|mando|paso)\s+el\s+sinpe` +
    String.raw`|(?:puedo|se\s+puede|podr[ií]a)\s+(?:hacer\s+el\s+pago|pagar(?:lo|la|le)?)\s+(?:ma[nñ]ana|pasado\s+ma[nñ]ana|m[aá]s\s+tarde|despu[eé]s|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))(?:\s+y\s+(?:env[ií]o|mando|paso)\s+el\s+comprobante)?` +
    String.raw`|(?:y\s+)?(?:el\s+)?(?:env[ií]o\s+y\s+(?:el\s+)?pago|pago\s+y\s+(?:el\s+)?env[ií]o)\s+c[oó]mo\s+(?:ser[ií]a|es|funciona)` +
    String.raw`|c[oó]mo\s+(?:ser[ií]a|es|funciona)\s+(?:el\s+)?(?:env[ií]o\s+y\s+(?:el\s+)?pago|pago\s+y\s+(?:el\s+)?env[ií]o)` +
    String.raw`|(?:quiero\s+pagar(?:\s+ya|\s+ahora|\s+ahorita)?\s*,?\s*)?(?:te|le|les)\s+(?:paso|mando|doy|env[ií]o|puedo\s+(?:mandar|pasar|dar|enviar))\s+(?:el\s+)?n[uú]mero\s+de\s+(?:la\s+|mi\s+)?tarjeta(?:\s+por\s+(?:ac[aá]|aqu[ií]|el\s+chat|whatsapp))?` +
    // "Dale, pago por SINPE. ¿Me pasás el número y a nombre de quién?" (the ask; the choice is a context sentence)
    String.raw`|me\s+(?:pas[aá]s|das|envi[aá]s|mand[aá]s|compart[ií]s)\s+(?:el\s+)?n[uú]mero(?:\s+(?:del?\s+)?sinpe)?(?:\s+y\s+(?:a\s+)?nombre\s+de\s+qui[eé]n)?` +
    String.raw`|a\s+nombre\s+de\s+qui[eé]n(?:\s+(?:est[aá]|sale|va))?` +
    String.raw`|(?:quiero|quisiera|me\s+gustar[ií]a)\s+pagar\s+(?:por|con)\s+(?:sinpe(?:\s+m[oó]vil)?|transferencia|tarjeta|efectivo)(?:\s*,?\s*(?:cu[aá]nto|c[oó]mo)\s+ser[ií]a)?` +
    String.raw`|(?:puedo|se\s+puede)\s+pagar\s+contra\s*entrega` +
  String.raw`)$`,
  'iu',
)
/**
 * Rafael 2026-10-24 (all agents): a question about paying BEFORE buying is answered by the agent (the total with
 * shipping, the methods, then the order data) — only a real payment goes to a person. "¿Pago envío?", "Si llevo 3,
 * ¿pago envío?", "¿Cuánto pago de envío?", "¿El envío lo pago yo?", "¿Cuánto sería en total?". Whole-sentence shapes
 * like the ones above; a quantity (1–2 digits or a number word) is allowed only right after "si llevo / compro".
 */
const QTY = String.raw`(?:\d{1,2}(?![.,]?\d)|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+(?:kits?|parches?|cajas?|unidades|paquetes?|combos?|bolsas?|tiras?|arn[eé]s(?:es)?))?`
const QTY_IF = String.raw`(?:y\s+)?(?:si\s+)?(?:llevo|compro|pido|encargo|me\s+llevo|ocupo|quiero)\s+${QTY}`
/** The quantity clause, masked before the whole-message digit ban (an amount like "20.000" or "3000" never matches). */
const QTY_IF_MASK_RE = new RegExp(String.raw`(?<![\p{L}\d])${QTY_IF}(?![\p{L}\d])`, 'giu')
const QTY_IF_SEG_RE = new RegExp(String.raw`^${QTY_IF}$`, 'iu')
const PAY_SHIP = String.raw`(?:el\s+)?env[ií]o`
/** The quantity may also close the question ("¿Pago envío si llevo 3?"). */
const QTY_AFTER = String.raw`(?:\s*,?\s*${QTY_IF})?`
/** "pago / pagar" as a verb: only in a sentence the customer wrote as a question (¿ or ?). */
const PAY_SHIP_ASK_SEG_RE = new RegExp(
  String.raw`^(?:${QTY_IF}\s*,?\s*)?(?:y\s+)?(?:` +
    String.raw`(?:tengo\s+que\s+|hay\s+que\s+)?pag(?:o|ar)\s+${PAY_SHIP}(?:\s+(?:aparte|tambi[eé]n|yo))?` +
    String.raw`|${PAY_SHIP}\s+(?:lo\s+)?pago\s+(?:yo|aparte)` +
    String.raw`|${PAY_SHIP}\s+se\s+paga\s+aparte` +
    String.raw`)${QTY_AFTER}$`,
  'iu',
)
/**
 * "¿Cuánto sería en total?" / "¿Quién paga el envío?": price questions, with or without a question mark. Verifier r1 #2:
 * never "queda" / "del total" (how much is LEFT = a part payment, a person).
 */
const PAY_TOTAL_ASK_SEG_RE = new RegExp(
  String.raw`^(?:${QTY_IF}\s*,?\s*)?(?:y\s+)?(?:` +
    String.raw`qui[eé]n\s+paga\s+${PAY_SHIP}` +
    String.raw`|cu[aá]nto\s+(?:pago|pagar[ií]a|ser[ií]a|es|sale|cobran)\s+(?:de|del|por\s+el|el|en|con)\s+env[ií]o(?:\s+(?:a|para)\s+(?<place>\p{L}+(?:\s+\p{L}+){0,3}))?` +
    String.raw`|cu[aá]nto\s+(?:pago|pagar[ií]a|ser[ií]a|es|sale)\s+(?:todo\s+)?(?:en\s+|el\s+)?total(?:\s+con\s+(?:el\s+)?env[ií]o)?` +
    String.raw`)${QTY_AFTER}$`,
  'iu',
)
/** SecureDog r1 (2026-10-24): words that never belong to a place name ("a Heredia Recibido", "a Heredia Puse Plata"). */
const PLACE_PAY_RE =
  /(?<![a-z])(?:recib[a-z]*|plata|dinero|puse|pus[a-z]*|di|dimos|dio|envi[a-z]*|mand[a-z]*|complet[a-z]*|confirm[a-z]*|hecho|ok|sinpe|comprobante|monto|cuenta|mitad|resto|saldo|adelanto|lleg[a-z]*|cay[a-z]*|entr[a-z]*|realiz[a-z]*|efectu[a-z]*|acredit[a-z]*|aprob[a-z]*|qued[a-z]*|gracias)(?![a-z])/
/**
 * "¿Cuánto pago de envío a Heredia?": the words after "a / para" are a place — each a capitalised name or a place
 * word (like "vivo en …"), no payment / done stem, no filler. SecureDog r1: never in the strict form (the "¿ya pagó?"
 * check still reads a free place).
 */
function payTotalAsk(seg: string, strict: boolean): boolean {
  const m = PAY_TOTAL_ASK_SEG_RE.exec(seg)
  if (!m) return false
  const place = m.groups?.place
  if (!place) return true
  if (strict) return false
  const bare = place.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (CONTEXT_FORBIDDEN_RE.test(bare) || PLACE_PAY_RE.test(bare)) return false
  return place.split(/\s+/u).every((w) => PLACE_WORD_RE.test(w) && !PLACE_FILLER_RE.test(w))
}
/** Verifier r1 #1: a yes / ok in front ("Sí, cuánto pago de envío?") can answer the store's "¿Pudiste pagar?". */
const YES_PREFIX_RE = /(?<![\p{L}])(?:s[ií]|ok|okay|okey|oki|perfecto|dale|claro|bueno|va|genial|excelente|s[uú]per|listo|lista|hecho|pura\s+vida|de\s+una|gracias)(?![\p{L}])/iu
/** The sentence opens with the quantity verb ("llevo 2 …"), so a stripped "si " right before it was the if. */
const QTY_SI_RE = /^(?:llevo|compro|pido|encargo|me\s+llevo|ocupo|quiero)\s/iu
const QTY_SI_PREFIX_RE = /(?<![\p{L}])si\s+$/iu
function isPayShipAsk(seg: string, question: boolean, strict = false): boolean {
  // Verifier r1 #3: "envio" here is always the noun (the shape is anchored), never "envió" (sent).
  const s = seg.replace(/(?<![\p{L}])envio(?![\p{L}])/giu, 'envío')
  const ok = payTotalAsk(s, strict) || (question && PAY_SHIP_ASK_SEG_RE.test(s))
  return ok && !hasHardPaymentClaim(s) && !hasFreePayAct(s) && !PARTIAL_STATE_RE.test(s) && !DEBT_RE.test(s)
}
/**
 * Lane C D2: a context sentence around a closed question ("Lo quiero talla XL", "Vivo en Heredia centro") — never with
 * a done / past word (checked by the caller), never a digit (checked for the whole message).
 */
const CLOSED_PAY_CONTEXT_SEG_RE =
  /^(?:lo|la)\s+quiero(?:\s+(?:en\s+)?(?:talla|color)\s+[\p{L}]{1,12})?$|^vivo\s+en\s+[\p{L}]+(?:\s+[\p{L}]+){0,3}$/iu
/** Strict context (the "¿ya pagó?" check and the receipt cue): only "Lo quiero" with a size from a closed list. */
const CLOSED_PAY_STRICT_CONTEXT_SEG_RE = /^(?:lo|la)\s+quiero(?:\s+(?:en\s+)?talla\s+(?:xxs|xs|s|m|l|xl|xxl|xxxl|peque[nñ]a|mediana|grande))?$/iu
/**
 * SecureDog r2 F1: the free words after "vivo en" are a place — a capitalised name or a place word ("Vivo en Heredia
 * centro", "Vivo en San José", "Vivo en Santa Ana de Escazú"), never a lowercase verb ("mi esposa mando").
 */
const PLACE_WORD_RE = /^(?:\p{Lu}\p{L}*|de|del|la|el|los|las|centro|cerca|norte|sur|este|oeste|barrio|residencial|condominio)$/u
const PLACE_FILLER_RE = /^(?:lo|le|les|se|me|te|nos|mi|tu|su|ya|todo|toda|todos|bien|mal|que|y|e)$/iu
/**
 * SecureDog r3: the strict form (the "¿ya pagó?" check, the receipt cue) never skips a sentence that opens with a yes —
 * "Sí, gracias. ¿A nombre de quién sale?" can answer the store's "¿Pudiste hacer el SINPE?".
 */
const STRICT_LEADING_YES_RE =
  /(?:^|[.!?\n])[\s¿¡]*(?:s[ií]|claro|ok|oki|okey|dale|listo|va|bueno|perfecto|exacto|correcto)(?![\p{L}])/iu
const EMOJI_JOINER_RE = new RegExp(
  `(\\p{Extended_Pictographic})[${String.fromCharCode(0xfe0e, 0xfe0f, 0x200d)}]+(?=\\p{Extended_Pictographic}|\\s|[.!?,]|$)`,
  'gu',
)
/** "Dale, pago por SINPE": the method choice, a fully anchored shape (no room for a claim). */
const CLOSED_PAY_CHOICE_SEG_RE =
  /^(?:(?:dale|ok|okey|perfecto|bueno|va)\s*,?\s*)?(?:pago|pagar[eé]|voy\s+a\s+pagar|te\s+pago|le\s+pago|lo\s+pago)\s+(?:por|con)\s+(?:sinpe(?:\s+m[oó]vil)?|transferencia|tarjeta|efectivo)$/iu
/**
 * Verifier r2 #1: the free words of a context sentence ("Vivo en Heredia y le pague") never carry a connector or a
 * payment / done stem, whatever the accents or capitals ("Vivo en Heredia Pagué", "cancele", "abone").
 */
const CONTEXT_FORBIDDEN_RE =
  /(?<![a-z])(?:y|e|pero|que|porque|ya|pag[a-z]*|cancel[a-z]*|abon[a-z]*|deposit[a-z]*|transf[a-z]*|trasf[a-z]*|sinp[a-z]*|simp[a-z]*|cinp[a-z]*|hic[a-z]*|hiz[a-z]*|hech[a-z]*|list[oa]s?|mande|envie|pase|tire|gire|meti|deje|cubri|liquid[a-z]*|sald[a-z]*|comprob[a-z]*)(?![a-z])/
/**
 * Lane C D2 round 3: everyday spellings of SINPE ("simpe", "sinpi") and a split clitic ("hacer te un simpe") read as the
 * clean form. Used for the closed shape and as an extra hand-off reading — never to clear a message the raw text flags.
 */
export function normalizePaySpelling(v: string): string {
  return v
    .replace(/(?<![\p{L}])(?:s[iy]mpe|sinpi|simpi|cinpe)(?![\p{L}])/giu, 'sinpe')
    .replace(/(?<![\p{L}])(hacer|mandar|enviar|pasar|depositar|transferir)\s+(te|le|les)(?![\p{L}])/giu, '$1$2')
}
/**
 * opts.payShip=false: only the shapes before 2026-10-24. opts.yesBlocksAll (the "¿ya pagó?" gate only): a yes / ok anywhere
 * refuses every shape; the receipt cue keeps the old strict meaning (Verifier r2 #2).
 */
export function isClosedPayInfoQuestion(text: string, opts: { strict?: boolean; payShip?: boolean; yesBlocksAll?: boolean } = {}): boolean {
  // SecureDog r3: an emoji's own variation selector / joiner ("❤️", "👨‍👩") is not an invisible gap; after a letter it is.
  if ((text || '').length > 400) return false
  const raw = (text || '').replace(EMOJI_JOINER_RE, '$1')
  if (opts.strict && STRICT_LEADING_YES_RE.test(raw)) return false
  // SecureDog r2 F1: invisible / line-separator characters, look-alike letters and foreign payment words never get the
  // exemption ("Vivo en Heredia ya<U+2028>pague", Cyrillic "уа раgue", "paiement envoyé"): the normal rules decide.
  if (raw.length > 400) return false
  const v = clean(normalizePaySpelling(stripFormatChars(raw.normalize('NFKC'))))
  if (!v.trim() || v.length > 200 || /\d/.test(v.replace(QTY_IF_MASK_RE, ' '))) return false
  if (invisibleAsGap(raw) !== null || hasMixedScriptWord(raw) || hasForeignPaymentState(raw)) return false
  // Rafael 2026-10-24: each sentence remembers whether it was written as a question ("¿…" or "…?") and whether a yes /
  // ok was stripped in front of it (Verifier r1 #1, #5: kept per sentence, not per text).
  const parts = [...v.replace(/¿/gu, '\u0001¿').matchAll(/([^.!?\n\u0001]+)([.!?\n\u0001]*)/gu)]
    .map((m) => {
      const lead = m[1].replace(/^[\s¿¡,]+/u, '').replace(/[\s,]+$/u, '')
      const t = lead.replace(LEADING_GREETING_RE, '').trim()
      // "si llevo 2 …": that "si" is the if of the quantity clause, not a yes (only when written without a comma).
      const stripped = lead.slice(0, lead.length - t.length)
      const prefix = QTY_SI_RE.test(t) ? stripped.replace(QTY_SI_PREFIX_RE, '') : stripped
      // A sentence made only of greetings / yes words ("Hola, ok", "Genial") is a yes when one of them is.
      const onlyGreetings = !`${t} `.replace(LEADING_GREETING_RE, '').trim()
      return { t, q: m[1].includes('¿') || m[2].includes('?'), yes: YES_PREFIX_RE.test(prefix) || (onlyGreetings && YES_PREFIX_RE.test(lead)) }
    })
  // SecureDog r2 R1: a yes / ok anywhere in the message, also as its own sentence ("Hola, ok. ¿Pago envío?", "Genial. …").
  const anyYes = parts.some((p) => p.yes)
  parts.splice(0, parts.length, ...parts.filter((p) => p.t))
  // Lane C D2: a context sentence ("Lo quiero talla XL", "Vivo en Heredia centro") may sit next to the ask, never a done word.
  const isContext = (t: string) => {
    const s = t.replace(/\s+/gu, ' ')
    if (hasHardPaymentClaim(s) || hasPastOrDoneWord(t, false)) return false
    // Rafael 2026-10-24: "Si llevo 3" next to "¿pago envío?" (the quantity clause only, nothing else).
    if (QTY_IF_SEG_RE.test(s)) return true
    if (opts.strict) return CLOSED_PAY_STRICT_CONTEXT_SEG_RE.test(s)
    if (CLOSED_PAY_CHOICE_SEG_RE.test(s)) return true
    const bare = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (!CLOSED_PAY_CONTEXT_SEG_RE.test(s) || CONTEXT_FORBIDDEN_RE.test(bare)) return false
    const place = /^vivo\s+en\s+(.+)$/iu.exec(s)
    // SecureDog r1 L4 / r2 F3: money / done words never in the place ("Vivo en Heredia Puse Plata").
    if (place && PLACE_PAY_RE.test(bare)) return false
    // SecureDog r3: "VIVO EN HEREDIA JUAN LO MANDO" — pronouns / fillers are never part of a place, in any case.
    return !place || place[1].split(' ').every((w) => PLACE_WORD_RE.test(w) && !PLACE_FILLER_RE.test(w))
  }
  // SecureDog r1 M2 (2026-10-24): in the strict form a yes / ok stripped in front of ANY sentence ("Gracias ¿sí, a nombre
  // de quién sale?") keeps the "¿ya pagó?" check — it can answer the store's "¿Pudiste hacer el SINPE?".
  if (opts.strict && opts.yesBlocksAll && anyYes) return false
  // Verifier r2 #6: a quantity clause only ever rides with the new price / shipping shapes, never an older shape.
  const hasQty = v.replace(QTY_IF_MASK_RE, '') !== v
  const asks = parts.filter((p) => !CLOSED_PAY_INFO_COURTESY_RE.test(p.t) && !isContext(p.t))
  return (
    asks.length > 0 &&
    asks.every((p) => {
      const one = p.t.replace(/\s+/gu, ' ')
      return (CLOSED_PAY_INFO_SEG_RE.test(one) && !hasQty) || (opts.payShip !== false && !anyYes && isPayShipAsk(one, p.q, opts.strict === true))
    })
  )
}
/** Rafael 2026-10-24: the message is closed ONLY through the price / shipping shapes ("¿pago envío?"). */
export function isPayShipOnlyQuestion(text: string): boolean {
  return isClosedPayInfoQuestion(text) && !isClosedPayInfoQuestion(text, { payShip: false })
}
/**
 * Verifier r2 #1: a message that the rules alone hand off (live 89adc2ee: a person) and only the new shapes answer
 * ("¿Pago envío?"). The burst money check and the legacy worker apply to these only, so nothing live answers changes.
 */
export function isRescuedPayShipQuestion(text: string): boolean {
  return isPayShipOnlyQuestion(text) && classifyPaymentTextRules(text) === 'payment_proof_or_risk'
}
/**
 * Verifier r3 (2026-10-24): an allow-list, like every other closed shape. A rescued "¿pago envío?" is answered only when
 * every OTHER unanswered bubble is a greeting or a plain order line ("Hola", "Quiero 3 kits", "Me interesa el avión").
 * Anything else next to it — an amount, a yes / ok / gracias, a done word or emoji, order data, a second question — keeps
 * the live path (a person), so this can only ever answer less than it could, never more than it should.
 */
const CLEAN_GREETING_RE =
  /^[\s¡!¿.,]*(?:(?:hol+a+|holi|buenas(?:\s+(?:tardes|noches))?|buenos\s+d[ií]as|buen\s+d[ií]a|upe|disculpe?|una\s+consulta|consulta)[\s!.,]*)+$/iu
const CLEAN_ORDER_RE =
  /^(?:(?:hol+a+|buenas|buenos\s+d[ií]as)[\s,!.]+)?(?:quiero|queremos|me\s+interesan?|me\s+gustar[ií]a|ocupo|necesito|busco|ando\s+buscando|llevo|me\s+llevo)(?:\s+[\p{L}\d]+){0,8}[\s!.]*$/iu
const ORDER_LINE_FORBIDDEN_RE =
  /(?<![\p{L}])(?:plat\p{L}*|diner\p{L}*|devol\p{L}*|devuelv\p{L}*|reembols\p{L}*|cobr\p{L}*|mil|miles|rojos?|tejas?|lucas?|colon\p{L}*|verifi\p{L}*|revis\p{L}*|factur\p{L}*|gu[ií]a|(?:mi|el|otro|ese|del)\s+pedido|pedido\s+(?:anterior|pasado)|esperando|reclam\p{L}*|queja|(?:\d+|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:d[ií]as?|semanas?|horas?|meses|mes|a[nñ]os?))(?![\p{L}])/iu
/**
 * Verifier r6 (2026-10-24): a recent bubble (10-minute window, answered or not) that still says money happened — a hard
 * claim, a part payment / debt or a colón amount — keeps a rescued "¿pago envío?" with a person.
 */
export function hasRecentMoneyState(text: string): boolean {
  const t = stripFormatChars((text || '').normalize('NFKC'))
  // A price asked back ("₡17 900?") is not money said.
  return hasHardPaymentClaim(t) || PARTIAL_STATE_RE.test(t) || DEBT_RE.test(t) || (/[₡¢]\s?\d/u.test(t) && !/[?¿]/u.test(t))
}
export function isCleanPayShipNeighbour(text: string): boolean {
  const t = stripFormatChars((text || '').normalize('NFKC')).trim()
  if (!t) return true
  if (t.length > 120 || invisibleAsGap(text || '') !== null || hasMixedScriptWord(text || '')) return false
  if (CLEAN_GREETING_RE.test(t)) return true
  // A bare quantity answering "¿Cuántos querés?" ("2", "3 kits").
  if (new RegExp(String.raw`^${QTY}[\s!.]*$`, 'iu').test(t)) return true
  if (!CLEAN_ORDER_RE.test(t)) return false
  // Verifier r4 #2: no money, refund or after-purchase words in an "order line", and "llevo 3 días" is not a quantity.
  if (ORDER_LINE_FORBIDDEN_RE.test(t)) return false
  if (/\d/.test(t.replace(QTY_IF_MASK_RE, ' '))) return false
  return !YES_PREFIX_RE.test(t) && !hasPaymentWord(t) && !hasHardPaymentClaim(t) && !PARTIAL_STATE_RE.test(t) && !DEBT_RE.test(t) && !hasPastOrDoneWord(t, false)
}
/** An offer to send the card number by chat (one of the closed shapes above). */
const CARD_BY_CHAT_RE =
  /(?:paso|mando|doy|env[ií]o|escribo|mandar|pasar|dar|enviar|escribir)\s+(?:el\s+|los\s+|la\s+|una\s+)?(?:n[uú]meros?|datos|d[ií]gitos|foto)\s+de\s+(?:la\s+|mi\s+)?tarjeta/iu
/** SecureDog r3: the customer offers card data by chat (the decision answers with the store's card link). */
export function isCardByChatOffer(text: string): boolean {
  return CARD_BY_CHAT_RE.test(stripFormatChars((text || '').normalize('NFKC')))
}
/** A sentence that is only a greeting / courtesy ("Hola,", "Disculpe", "Una consulta") around the question. */
const CLOSED_PAY_INFO_COURTESY_RE =
  // Verifier r2 #3: "Perfecto, ¿qué le pongo de detalle?". Never sí / claro / listo / ya / hecho (they can answer "¿ya pagó?").
  /^(?:hola|holi|buenas|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|disculpe?|perd[oó]n|ok|oki|okey|gracias|muchas\s+gracias|una\s+consulta|consulta|pura\s+vida|(?:ok\s+|okey\s+)?(?:perfecto|dale|genial|excelente|bueno|va))$/iu

/**
 * Lane C D8: price / total / size / shipping-to words (Rafael 2026-10-27: "Qué costó tiene…" with a typo), or an
 * opinion / worry about paying ("¿qué es mejor, SINPE o
 * tarjeta? No quiero dar mi tarjeta") — the message asks more than which methods there are.
 */
const ASKS_MORE_THAN_PAYMENT_RE =
  /(?<![\p{L}])(?:cu[aá]nto|total|precio|cuesta|cuestan|cost\p{L}*|vale|valen|sale|salen|incluye|trae|talla|tallas|mido|peso|medida|medidas|env[ií]o\s+a|tama[nñ]o|mejor|conviene|recomend\p{L}*|segur[oa]s?|seguridad|confiable|confianza|miedo|no\s+quiero|prefiero\s+no)(?![\p{L}])/iu

export function classifyPaymentText(
  text: string,
  opts: { awaitingPaymentMethod?: boolean; noPaymentYet?: boolean; nothingPaidYet?: boolean } = {},
): PaymentClassification {
  // SecureDog INT-201: the latest message too is read with invisible characters as gaps; a hand-off in either wins.
  const gapped = invisibleAsGap(text)
  const plain = classifyPaymentTextRules(text, opts)
  // Lane C D2 round 3: "ya te hice el simpe" is read as "sinpe" too (only ever adds a hand-off).
  const spelled = normalizePaySpelling(text || '')
  const cls =
    (plain !== 'payment_proof_or_risk' && gapped !== null && classifyPaymentTextRules(gapped, opts) === 'payment_proof_or_risk') ||
    (plain !== 'payment_proof_or_risk' && spelled !== text && classifyPaymentTextRules(spelled, opts) === 'payment_proof_or_risk') ||
    hasMixedScriptWord(text)
      ? 'payment_proof_or_risk'
      : plain === 'payment_proof_or_risk' || !hasForeignPaymentState(text)
        ? plain
        : 'payment_proof_or_risk'
  // A closed before-paying question (every sentence one anchored shape, no digit) that a word rule would hand off is
  // answered by the agent instead, like any other sales question.
  if (cls === 'payment_proof_or_risk' && isClosedPayInfoQuestion(text)) {
    // SecureDog r2 F2: "te paso el número de mi tarjeta por acá?" gets the code card reply (the store's card link), never
    // a free model answer that could ask for the card data.
    return CARD_BY_CHAT_RE.test(stripFormatChars((text || '').normalize('NFKC'))) ? 'payment_info_safe' : 'non_payment'
  }
  return cls
}

/**
 * Lane C D8: a payment-info question that also asks something else ("… cuánto sería el total con envío y cómo puedo
 * pagar?", "¿qué es mejor, SINPE o tarjeta?") is answered by the model, not the code method list. The caller applies it
 * only when the store shares payment data by chat (Verifier r2 #2: otherwise the payment-data review must still run).
 */
export function asksMoreThanPayment(text: string): boolean {
  return ASKS_MORE_THAN_PAYMENT_RE.test(stripFormatChars((text || '').normalize('NFKC')))
}

function classifyPaymentTextRules(
  text: string,
  /**
   * awaitingPaymentMethod: the store's method question is pending. noPaymentYet (Sleeping C2): nothing about paying happened
   * in this chat yet (sales-state noPaymentYet) — a bare order-confirm ask is then not a payment cue.
   */
  opts: { awaitingPaymentMethod?: boolean; noPaymentYet?: boolean; nothingPaidYet?: boolean } = {},
): PaymentClassification {
  // Rafael 2026-10-18: "Nombre: … Dirección: … Pago por SINPE 🙌" with nothing paid yet (sales-state nothingPaidYet: no
  // payment details from the store, no photo / file or payment message from the customer) is a CHOICE.
  // embeddedPaymentChoice runs every claim check below itself (hasHardPaymentClaim included) and rejects any cue.
  if (opts.nothingPaidYet && embeddedPaymentChoice(text)) return 'payment_info_safe'
  // SecureDog: full-width / invisible-character spellings ("ＳＩＮＰＥ ✅", "he\u200Bcho") are read as plain text.
  const value = maskNonPaymentPhrases(stripFormatChars((text || '').normalize('NFKC')))
  if (!value.trim()) return 'non_payment'
  if (SENT_AMOUNT_CLAIM_RE.test(value)) return 'payment_proof_or_risk'
  if (
    PROOF_CUE_RE.test(value) ||
    hasPaymentClaimCue(value) ||
    confirmCueCounts(value, opts.noPaymentYet === true) ||
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
  // SecureDog r4 INT-167: "¿Les llegó?", "¿Le cayó?", "¿Lo recibieron?" — a payment status question (never "¿lo tienen?").
  if (NARROW_STATUS_QUESTION_RE.test(value)) return 'payment_proof_or_risk'
  // INT-115: "Transferencia realizada", "tarjeta aprobada", "Listo, transferencia", ✅ — a claim, not an info question.
  if (isPaymentCompletionClaim(value)) {
    return 'payment_proof_or_risk'
  }
  if (COD_QUESTION_RE.test(value)) {
    return agentExit(value, 'non_payment')
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
  if (isCardInfoMessage(value)) return 'payment_info_safe'
  // Verifier round 8: "¿Puedo pagar con link de pago?" is a plain ask; only a failure word or a non-plain message hands off.
  if (PAYMENT_LINK_WORDS_RE.test(value) && (LINK_FAILURE_RE.test(value) || (PAY_LINK_PHRASE_RE.test(value) && !isPlainAskMessage(value)))) return 'payment_proof_or_risk'
  // SecureDog round 5: the intent path too answers only a plain ask (a leading "listo," is an acknowledgement).
  if (isPaymentIntentText(value) && !INFO_CUE_RE.test(value)) return agentExit(value.replace(LEADING_LISTO_RE, ''), 'non_payment')
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
    return agentExit(value, 'payment_info_safe')
  }
  if (isPlainFutureSinpeQuestion(value)) return 'non_payment'
  // An explicit "how / can I pay" question ("¿puedo pagar en efectivo?", "¿cuándo se paga?") is answered by the agent
  // under the fixed payment rules; everything else with payment words stays with a person (fail closed).
  if (PAYMENT_RE.test(value) && PAYMENT_QUESTION_RE.test(value)) {
    return agentExit(value, 'non_payment')
  }
  // B5 (Agentes IA 2.0), narrowed after SecureDog INT-93: ONLY an explicit list of info questions reaches the agent
  // ("¿el pago es por adelantado?", "¿con qué banco es el sinpe?", "¿aceptan tarjeta?") and never one that asks about
  // the state of a payment ("¿se acreditó el pago?", "¿mi sinpe es válido?"). Everything else stays with a person.
  if (PAYMENT_RE.test(value) && isPaymentInfoQuestion(value)) {
    return agentExit(value, 'non_payment')
  }
  // Pura Sonrisa exam P4: "¿cómo sería el envío y el pago?" / "y el pago como sería" — the WHOLE message (after a
  // greeting) is this closed how-does-it-work question: the agent answers with the method list.
  if (isHowPayShipQuestion(value)) return 'payment_info_safe'
  // Prototipo shoppers: closed pre-purchase questions naming a method (how to order / how much with shipping).
  if (isPrePurchaseMethodQuestion(value)) return 'payment_info_safe'
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
  const read = (t: string) => PAYMENT_RE.test(t) || hasPaymentProofCue(t) || hasPaymentClaimCue(t)
  // SecureDog INT-201 / M1: invisible characters read as gaps too; English / PT / FR payment state opens the context.
  const gapped = invisibleAsGap(text)
  return read(text || '') || (gapped !== null && read(gapped)) || hasForeignPaymentState(text)
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
    // Live 467818: customers write SINPE as "simpe" / "sinpi" — the same method (a choice, never a claim by itself).
    .replace(/(?<![\p{L}])(?:simpe|sinpi|simpi)(?![\p{L}])/gu, 'sinpe')
    .trim()
}

const METHOD = String.raw`(sinpe(?: movil)?|transferencia(?: bancaria)?|tarjeta(?: de (?:credito|debito))?|contra ?entrega|al recibir(?:lo|la)?|efectivo)`
// Rafael 2026-10-25 (Dani Probar): "seria sinpe" — "sería / va a ser / lo pago por / elijo / escojo" + the method only.
const LEAD = String.raw`(?:(?:prefiero pagar|prefiero|mejor|quiero pagar|voy a pagar|quisiera pagar|(?:te|le|les) pago|pago|seria|va a ser|lo pago|lo voy a pagar|elijo|escojo)\s+)?(?:(?:por|con|en)\s+)?(?:el\s+|la\s+)?`
const TAIL = String.raw`(?:\s*,?\s*(?:porfa|por favor|gracias|pls|esta bien|mejor|entonces|por la web|por la pagina|en la web|en la pagina)){0,3}[\s.!🙏😊🙌]*`
// Pura Sonrisa P4: the imperative ask too ("Por SINPE, pasame el número", "mandame los datos").
const ASK_HEAD = String.raw`¿?\s*(?:me\s+(?:pasas|pasa|das|da)|pasame|mandame|dame|regalame|enviame|cual\s+es|a\s+que)\s+(?:el\s+|los\s+|la\s+)?(?:numero|cuenta|link|datos)`
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
/** An accent outside á é í ó ú ü ñ or a combining mark (foldChoice would hide it from the claim checks). */
function hasOddAccent(raw: string): boolean {
  const v = raw.normalize('NFC')
  return /[̀-ͯ]/u.test(v) || /[À-ɏ]/u.test(v.replace(/[áéíóúüñÁÉÍÓÚÜÑ]/gu, ''))
}
/** Order data keeps names like François / Zoë: only a payment word with an odd accent ("pagò", "cancelò") rejects it. */
function hasOddAccentPayWord(raw: string): boolean {
  return (raw.normalize('NFC').match(/\p{L}[\p{L}\p{M}]*/gu) ?? []).some(
    (w) => hasOddAccent(w) && /^(?:pag|cancel|abon|deposit|transf|sinp)/u.test(foldChoice(w).toLowerCase()),
  )
}
export function paymentChoiceGrammar(text: string): { method: PaymentChoiceMethod; ask: boolean } | null {
  const raw = (text || '').normalize('NFKC').replace(FORMAT_CHARS_RE, '')
  if (!raw.trim() || raw.length > 160 || CHOICE_REJECT_RE.test(raw) || PAYMENT_COMPLETION_RE.test(raw)) return null
  // SecureDog 2026-10-25: foldChoice strips every accent, the claim checks only know á é í ó ú ü ñ — "Lo pagò por SINPE"
  // (any other accent or a combining mark) is never a clean choice.
  if (hasOddAccent(raw)) return null
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
  if (!raw.trim() || raw.length > 120 || /[?¿]/.test(raw) || CHOICE_REJECT_RE.test(raw) || hasOddAccent(raw)) return null
  if (!isCueFreePaymentChoiceText(raw) || isPaymentCompletionClaim(raw) || PAYMENT_COMPLETION_RE.test(raw)) return null
  if (hasPaymentStatusClaim(raw) || NEGATION_RE.test(raw)) return null
  const t = foldChoice(raw)
  if (STATUS_DISPUTE_RE.test(t)) return null
  // SecureDog: ONLY an exact choice followed by an explicit logistics phrase ("y retiro en tienda", "con envío a
  // Heredia", "a domicilio", "para Cartago"); anything else falls through to the normal path.
  const m = LOGISTICS_CHOICE_RE.exec(t)
  return m ? methodOf(m[1]) : null
}

/**
 * Anything in a data message that is more than order data + a choice: money (₡ $ ¢, "mil", "colones", 5–7 digit runs,
 * "25.000"), references, done / like emojis, receipts, "te llegó / lo vieron", past-tense sends, times, part payments,
 * "revisen / verifiquen", errors. Checked on the WHOLE message (raw, folded and with stretched letters collapsed).
 */
const DATA_CHOICE_REJECT_RE =
  /[#₡¢$€✅✔✓☑👍👌💸🧾📸📷]|(?<!\d)\d{5,7}(?!\d)|\d{1,3}[.,]\d{3}(?!\d)|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|(?<![\p{L}])(?:ref\p{L}*|c[oó]digo|monto|total|mil|k|colones|rojos|comprobante\p{L}*|recibo|captura|pantallazo|screenshot|voucher|constancia|foto|lleg\p{L}*|vieron|vio|cay[oó]|entr[oó]|entra|pagu[eé]|hice|hicimos|mand[eé]|envi[eé]|pas[eé]|transfer[ií]|deposit[eé]|cancel[eé]|pagamos|mandamos|enviamos|pasamos|ya|yast[aá]|listo|lista|hecho|hecha|sinpead\p{L}*|saldad\p{L}*|abon\p{L}*|chequ\p{L}*|f[ií]j\p{L}*|valid\p{L}*|revis\p{L}*|verific\p{L}*|confirm\p{L}*|av[ií]s\p{L}*|hace|antier|anteayer|ayer|anoche|hoy|reci[eé]n|ahorita|horita|ahora|temprano|rato|ratito|toque|minutos?|min|segundos?|horas?|fue|todo|efectu\p{L}*|realic\p{L}*|realiz\p{L}*|tir[eéó]|acab\p{L}*|di|dimos|error|doble|mitad|resto|adelanto|debo|debe|falta\p{L}*|pendiente|deja|problema|pus[eo]|pusimos|dej[eé]|dejamos|met[ií]|metimos|gir[eé](?!\s+(?:a\s+)?(?:la\s+)?(?:derecha|izquierda))|giramos|pagao|cancelao|tiramos|tiraron|cubr[ií]|cubrimos|adelantamos|complet[eé]|liquidad[oa]s?|liquid[eé]|liquidamos|liquidao|liquidó|girad[oa]s?|adelantad[oa]s?|debitad[oa]s?|rebajad[oa]s?|descontad[oa]s?|tramitad[oa]s?|ejecutad[oa]s?|concretad[oa]s?|finalizad[oa]s?|transacci[oó]n|mandao|enviao|pasao|tirao|girao|dejao|depositao|metio|kancel\p{L}*|list[ií]simo|hech[ií]simo|lizto|hexo|transfe|depo|payment|paid|wired|done|sent|payed|completed|received|finished|settled|cleared|feito|pronto|lysto|exo|tranfer\p{L}*|trasfer\p{L}*|cansel\p{L}*|simpee|ise|consignad\p{L}*|ingresad\p{L}*|finiquitad\p{L}*|evidencia|respaldo|prueba)(?![\p{L}])|(?<![\p{L}])(?:est[aá]|qued[oó]|ya)\s+puest[oa]s?(?![\p{L}])|(?<![\p{L}])puest[oa]s?(?!\s+(?:de|del|la|el)(?![\p{L}]))(?![\p{L}])|(?<![\p{L}])desde\s+(?:el|la|mi)\s+(?:bac|bcr|bn|banco|app)(?![\p{L}])|(?<![\p{L}])app\s+del?\s+(?:banco|bac|bcr|bn)(?![\p{L}])|(?<![\p{L}])ah[ií]\s+(?:l[oa]s?\s+)?(?:tienen?|ten[eé]s|tienes)(?![\p{L}])|(?<![\p{L}])al\s+d[ií]a(?![\p{L}])|(?<![\p{L}])(?:un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta)\s+(?:cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|nueve|ocho|siete|seis|cinco)(?![\p{L}])|(?<!\d)\d{1,3}(?:\s\d{1,3}){2,}(?!\d)|(?<![\p{L}])(?<!(?:tallas?|talas?|us|no|km|kg|lb|cm|kilómetro|kilometro|tamaño|tamano|número|numero|tenis|zapatos?|zapatillas?)[\s:.]{1,3})(?<!\d)\d{1,2}[.,]\d(?!\d)(?!\s*(?:kg|lb|g|ml|l|cm|m|km|oz)(?![\p{L}]))|(?<![\p{L}])(?:le|les|se\s+l[oa]s?)\s+(?:dejo|tiro|giro|meto|pongo|hago|env[ií]o|mando|paso)(?![\p{L}])|(?<![\p{L}])(?:les|le)\s+(?:cae|va|consta|figura)(?![\p{L}])|(?<![\p{L}])(?:ah[ií]\s+(?:le|les|te)\s+cae|ah[ií]\s+est[aá]|eso\s+est[aá])(?![\p{L}])|(?<!\d)\d{1,3}\s\d{3}(?!\d)/iu
/**
 * SecureDog r2 INT-B: money / receipt nouns a name or address never needs. Bank names stay ("200 m sur del BCR") and so
 * does "número" (Verifier r3: "casa número 25"; "al número" / "número de la bio" are rejected elsewhere).
 */
const DATA_VALUE_MONEY_RE =
  /(?<![\p{L}])(?:plata|platica|dinero|harina|billetes?|cuenta|print|imagen|sms|mensaje|cel|celular|bio)(?![\p{L}])/iu
/** Free-value word caps (SecureDog r2 INT-B; Verifier r3: CR "dirección exacta con señas" runs 20–30 words). */
const DATA_NAME_MAX_WORDS = 8
const DATA_VALUE_MAX_WORDS = 40
/**
 * SecureDog r3 INT-I: an earlier customer row (not a question, not an order-data choice) with done / money wording the
 * live classifier misses ("Le puse la plata", "pagao", "Ahí les cae", "Se lo tiramos", "Liquidado", "Listo", "Ya").
 */
/**
 * Verifier r4: SPECIFIC done / money phrases close the gate even in a question ("Le puse la plata ¿ok?"); "plata"
 * only with a verb or a done word ("color plata" is a product), dejé / puse / tiré only after le / les / se lo.
 */
const EARLIER_SPECIFIC_DONE_RE = new RegExp(
  [
    // Verifier r5: only as the whole row ("Ya le puse", "Se lo tiramos ok"), not "Le dejé un mensaje ayer".
    String.raw`^\s*(?:ya\s+)?(?:le|les|se\s+l[oa]s?)\s+(?:pus[eo]|pusimos|dej[eé]|dejamos|met[ií]|metimos|tir[eé]|tiramos|gir[eé]|giramos|complet[eé]|adelant[eé]|adelantamos|cubr[ií]|cubrimos)(?!\s+(?:(?:un|una|mi|mis|la|el|los|las|sus|tus|\d)\s+)?(?:mensaje|like|comentario|rese[nñ]a|direcci[oó]n|datos|n[uú]mero|talla|estrellas|dicho|nota|audio|foto|pedido|correo)(?![\p{L}]))(?![\p{L}])`,
    String.raw`(?:pus[eo]|pusimos|dej[eé]|dejamos|met[ií]|tir[eé]|tiramos|gir[eé]|mand[eé]|pas[eé]|envi[eé])\s+(?:la|el|mi|los)?\s*(?:plata|platica|dinero|harina|transfe|depo|sinpe|simpe)`,
    String.raw`(?:la|el)\s+(?:plata|dinero|transfe|depo|sinpe|simpe)\s+(?:ya\s+)?(?:qued[oó]|lleg[oó]|cay[oó]|entr[oó])`,
    // Verifier r5: "labial líquido", "en liquidación" are products, not payments.
    String.raw`liquidad[oa]s?|liquid[eé]|liquidamos|liquidao|liquidó|pagao|cancelao|mandao|enviao|pasao|tirao|depositao|ah[ií]\s+(?:le|les|te)\s+cae`,
  ]
    .map((p) => `(?:${p})`)
    .join('|'),
  'iu',
)
/** "La plata ya está", "el sinpe está listo": a statement only (Verifier r5: "¿El sinpe está habilitado?" is a question). */
const EARLIER_STATEMENT_DONE_RE = /(?<![\p{L}])(?:la|el)\s+(?:plata|dinero|transfe|depo|sinpe|simpe)\s+(?:ya(?![\p{L}])(?!\s+(?:se\s+)?(?:l[oa]s?\s+)?(?:hago|hacemos|mando|paso|env[ií]o|puedo|voy|hag\p{L}*))|est[aá](?![\p{L}])(?!\s+(?:habilitad|disponible|bien|activ|funcionando|abiert)))/iu
/** A glued / oddly spelled paid verb (not a bare "listo"): counts in any context ("yapague", "lohice"). */
const EARLIER_GLUED_PAID_RE = /^(?:ok)?(?:yapague|yapage|yalohice|lohice|yalehice|yalepase|yasinpe\p{L}*|yatransferi|yadeposite|yacancele)$/u
/** A bare done word, only as a short standalone row ("Listo", "Ya", "Ya está", "Listo ✅"). */
const EARLIER_BARE_DONE_RE = /^(?:ok\s+)?(?:ya|yast[aá]|ya\s+est[aá]|list[oa]|hech[oa]|ya\s+qued[oó])(?:\s+(?:ya|list[oa]|hech[oa]|est[aá]))?[\s.!,🙌🙏😊👍✅✔☑]*$/iu

/**
 * SecureDog r3 INT-I / Verifier r4: an earlier customer row the live classifier misses that may mean "I paid". The bare
 * form counts only after the store talked about payment (`afterStorePaymentTalk`: the only context where "Listo" = paid).
 */
export function earlierRowMayBeClaim(text: string, opts: { afterStorePaymentTalk?: boolean } = {}): boolean {
  const value = stripFormatChars((text || '').normalize('NFKC'))
  const folded = foldChoice(value).replace(/(\p{L})\1+/gu, '$1')
  if (EARLIER_SPECIFIC_DONE_RE.test(value) || EARLIER_SPECIFIC_DONE_RE.test(folded)) return true
  if (!/[?¿]/u.test(value) && (EARLIER_STATEMENT_DONE_RE.test(value) || EARLIER_STATEMENT_DONE_RE.test(folded))) return true
  const gluedPlain = foldChoice(value.replace(/[^\p{L}\d]/gu, '')).replace(/(\p{L})\1+/gu, '$1')
  if (gluedPlain.length <= 14 && EARLIER_GLUED_PAID_RE.test(gluedPlain)) return true
  // Verifier r5 N2: a bare done word with a check / like ("Listo ✅", "Ya está ✔") counts even with no store payment talk.
  if (/[✅✔☑]/u.test(value) && !/[?¿]/u.test(value) && (EARLIER_BARE_DONE_RE.test(value.trim()) || EARLIER_BARE_DONE_RE.test(folded.trim()))) return true
  if (!opts.afterStorePaymentTalk || /[?¿]/u.test(value)) return false
  if (EARLIER_BARE_DONE_RE.test(value.trim()) || EARLIER_BARE_DONE_RE.test(folded.trim())) return true
  // Verifier r5 F4: a short row spelled oddly ("l is t o", "l,i,s,t,o", "yapague", "lısto", "L1STO") counts too.
  const letters = value.replace(/[^\p{L}\d]/gu, '')
  if (letters.length > 12) return false
  if (DATA_LATIN_LOOKALIKE_RE.test(value) || DATA_ODD_BREAK_RE.test(text || '')) return true
  const plain = foldChoice(letters.replace(/1/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e').replace(/4/g, 'a')).replace(/(\p{L})\1+/gu, '$1')
  return /^(?:ok)?(?:ya|yasta|yaesta|listo|lista|hecho|hecha|yaquedo|pague|yapague|yalohice|lohice)$/u.test(plain)
}

/** Verifier r3 F4: a done / paid word split in two or three chunks ("lis to", "li s to", "pa gué"). */
const DATA_SPLIT_CLAIM_RE =
  /^(?:ya|yasta|listo|lista|hecho|hecha|pague|pagado|pagada|pago|sinpe\p{L}*|cancel\p{L}*|deposit\p{L}*|transfer\p{L}*|envie|mande|pase|hice|abon\p{L}*|confirm\p{L}*)$/u
/**
 * SecureDog r2 INT-D / r3 INT-J: an ALPHABET allowlist — Spanish letters only ("lısto" with a dotless i, "łisto", small
 * caps and every other look-alike fall out); emoji are checked separately.
 */
// Verifier r4: ASCII + Latin-1 letters ("Zoë", "João", "François"); dotless ı (U+0131) and ł (U+0142) stay out.
// SecureDog r4 INT-S: minus Ð Þ ß æ ð ø þ Æ Ø (no fold to a plain letter: "listø", "lißto").
const DATA_LATIN_LOOKALIKE_RE = /(?=\p{L})[^A-Za-z\u00C0-\u00C5\u00C7-\u00CF\u00D1-\u00D6\u00D9-\u00DD\u00E0-\u00E5\u00E7-\u00EF\u00F1-\u00F6\u00F9-\u00FD\u00FF]/u
/**
 * SecureDog r2 INT-D / r3 INT-G: line breaks other than \n / \r and every invisible / format character. They would be
 * deleted before the checks and glue a claim into one unknown token ("ya\u200Bpague"); order data never needs them.
 */
// SecureDog r4 INT-N: C0 / C1 controls too (stripFormatChars deletes them: "ya\u0001pague" → "yapague").
// eslint-disable-next-line no-control-regex
export const DATA_ODD_BREAK_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/u
/** "l i s t o": three or more single letters in a row. */
// SecureDog r4 INT-O: any separator ("l,i,s,t,o", "l/i/s/t/o", "l(i)s(t)o").
const DATA_SPACED_LETTERS_RE = /(?<![\p{L}])\p{L}(?:[^\p{L}\d\n]+\p{L}(?![\p{L}])){2,}/u
/** SecureDog r4 INT-O: a claim glued into one token ("yapague", "lepuse", "lohice", "selopague", "yacancele"). */
const DATA_GLUED_CLAIM_RE = /(?:yapag|yalo(?!r)|yaest|yale(?!s?$|ska$|ksa$)|yacancel|yatransf|yadeposit|yasinp|yahic|lepuse|lepase|letire|lohice|lapague|selopag|selomand|selopas|seloenvi)/u
const GLUED_NAME_OK = new Set(['calisto', 'callisto', 'kallisto', 'evaristo', 'modesto', 'ernesto', 'honesto', 'derecho', 'trecho', 'pecho', 'techo', 'helecho', 'barbecho', 'liston', 'listones', 'listonado'])
/** SecureDog r4 INT-O: a run of short chunks spelling a claim ("l is t o", "p ag u e", "tr an sf er i"). */
const DATA_CHUNKED_CLAIM_RE = /^(?:ya|yasta|yaesta|listo|lista|hecho|hecha|pague|pagado|pagada|sinpe\p{L}*|cancel\p{L}*|deposit\p{L}*|transfer\p{L}*|envie|mande|pase|hice|lohice|abon\p{L}*)$/u
/** A data message that carries a choice: short enough to read whole (a delivery-data block, not an essay). */
const DATA_CHOICE_MAX_CHARS = 600
const DATA_CHOICE_MAX_PARTS = 12
const DATA_STATUS_CUE_RE = new RegExp(String.raw`(?<![\p{L}])(?:${PAYMENT_STATUS_CUE_RE.source})`, 'iu')
/** The friendly emoji a choice may carry (paymentChoiceGrammar's TAIL); any other symbol / emoji → not a data choice. */
const DATA_CHOICE_EMOJI_RE = /[🙏😊🙌]/gu
/** The store's own list labels, read as their short form ("Nombre completo" — "completo" is a status word elsewhere). */
const DATA_LABEL_MASK_RE = /(?<![\p{L}])(?:nombre\s+completo|correo\s*\(opcional\)|direcci[oó]n\s+exacta(?:\s+con\s+se[nñ]as)?)(?![\p{L}])/giu
/** ALLOWLIST: a labelled order-data line ("Nombre: Ana Mora", "Teléfono: 8888-8888", "Dirección: …"). */
const DATA_LABEL_LINE_RE =
  /^(nombre|apellidos?|tel[eé]fono|tel|cel(?:ular)?|whats(?:app)?|wsp|correo(?:\s+electr[oó]nico)?|e-?mail|c[eé]dula|provincia|cant[oó]n|distrito|barrio|direcci[oó]n|se[nñ]as|cantidad|producto|env[ií]o|entrega|retiro)\s*[:=\-–]\s*(.+)$/iu
/** "Forma de pago: SINPE", "Método de pago: SINPE", "Pago: SINPE". */
const PAY_LABEL_LINE_RE = /^(?:(?:forma|m[eé]todo|medio)\s+de\s+pago|pago)\s*[:=\-–]\s*(.+)$/iu
const DATA_PHONE_RE = /^(?:\+?506[\s.-]?)?\d{4}[\s.-]?\d{4}$/u
const DATA_CEDULA_RE = /^(?:\d[\s-]?\d{3,4}[\s-]?\d{4}|\d{9,12})$/u
const DATA_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/iu
/** Plain delivery phrases on their own: "Envío a domicilio", "Retiro en tienda", "A domicilio". */
const DATA_DELIVERY_RE = /^(?:con\s+)?(?:env[ií]o\s+(?:a\s+(?:domicilio|la\s+casa|mi\s+casa)|por\s+correos)|a\s+domicilio|retiro\s+en\s+(?:la\s+)?tienda|paso\s+a\s+retirar(?:lo|la)?)$/iu
/** A free value (name / place / address): Latin letters, spaces, basic punctuation, numbers of up to 3 digits. */
// SecureDog r3 INT-J: a number never glued after a letter ("l1sto", "pagu3"); "casa 25", "2da entrada" stay valid.
// Verifier r4: an apartment code ("apto B4", "casa C3") is one capital letter + 1–2 digits, alone — never "L1sto".
const DATA_FREE_VALUE_RE = /^[\p{L}\s,.'()\-/]*(?:(?:(?<![\p{L}\d])\d{1,3}(?!\d)|(?<=(?:^|[^\p{L}])[A-Z])\d{1,2}(?![\p{L}\d]))[\p{L}\s,.'()\-/]*)*$/u

/** A data part with no payment word and no method word. */
function noPaymentTalk(part: string): boolean {
  const f = foldChoice(part)
  return !hasPaymentWord(part) && !LOOSE_METHODS.some(([re]) => new RegExp(re.source, 'u').test(f))
}

/** One non-choice part, read against the ALLOWLIST (label + value, phone, delivery phrase, courtesy). */
function isOrderDataPart(raw: string): boolean {
  const part = raw.replace(/[\s.!,;]+$/u, '').trim()
  if (!part) return true
  if (!noPaymentTalk(part)) return false
  if (DATA_PHONE_RE.test(part) || DATA_DELIVERY_RE.test(part) || isCourtesyText(part)) return true
  const m = DATA_LABEL_LINE_RE.exec(part)
  if (!m) return false
  const label = foldChoice(m[1])
  const v = m[2].trim()
  if (/^(?:tel|cel|whats|wsp)/u.test(label)) return DATA_PHONE_RE.test(v)
  if (label.startsWith('cedula')) return DATA_CEDULA_RE.test(v)
  if (/^(?:correo|e-?mail)/u.test(label)) return DATA_EMAIL_RE.test(v)
  if (label === 'cantidad') return /^\d{1,2}$/u.test(v)
  if (DATA_VALUE_MONEY_RE.test(v)) return false
  const words = v.split(/\s+/u).filter(Boolean)
  if (words.length > (/^(?:nombre|apellido)/u.test(label) ? DATA_NAME_MAX_WORDS : DATA_VALUE_MAX_WORDS)) return false
  const tokens = foldChoice(v).split(/[^a-z]+/u).filter(Boolean)
  if (tokens.some((t) => t.length >= 5 && DATA_GLUED_CLAIM_RE.test(t))) return false
  // Verifier r5 F3: a done stem glued to another word ("listoya", "hechoya", "sinpelisto"); "Calisto" is a name.
  if (tokens.some((t) => t.length >= 6 && !GLUED_NAME_OK.has(t) && /^(?:listo|hecho|pague|pagad|yasta|yaesta)|(?:listo|hecho|pague|pagad|yasta|yaesta)$/u.test(t))) return false
  // Every maximal run of ≤ 2-letter chunks, joined ("l is t o" → "listo").
  for (let i = 0; i < tokens.length; ) {
    let j = i
    let joined = ''
    while (j < tokens.length && (tokens[j].length <= 2 || (j > i && tokens[j].length <= 3))) joined += tokens[j++]
    if (j - i >= 2 && joined !== 'ya' && DATA_CHUNKED_CLAIM_RE.test(joined)) return false
    i = j > i ? j : i + 1
  }
  for (let i = 0; i < tokens.length; i++) {
    // Verifier r5 N1: "y a mano derecha", "y a la par" are directions, not "ya".
    const yA = tokens[i] === 'y' && tokens[i + 1] === 'a'
    if (!yA && DATA_SPLIT_CLAIM_RE.test(tokens.slice(i, i + 2).join('')) && i + 1 < tokens.length) return false
    if (i + 2 < tokens.length && DATA_SPLIT_CLAIM_RE.test(tokens.slice(i, i + 3).join(''))) return false
  }
  return DATA_FREE_VALUE_RE.test(v)
}

/**
 * Rafael 2026-10-18 (getting customers to pay): a method CHOICE written inside the order message — "Nombre: Ana …
 * Dirección: … Envío a domicilio. Pago por SINPE 🙌". SecureDog / Verifier r1: an ALLOWLIST like INT-114 — the message is
 * split into lines / sentences; the parts that match the choice grammar (no detail ask; "Forma de pago: SINPE"; a
 * trailing ", pago por SINPE") name ONE method, and EVERY other part is order data (a known label + a plain value, a
 * phone, a delivery phrase, a greeting). No "?", only Latin letters, only the friendly emoji, and the WHOLE message
 * (raw, folded, stretched letters collapsed) free of every claim / proof / status / time / amount / dispute cue. The
 * caller runs it on the whole unanswered burst and adds the history gate (sales-state nothingPaidYet). Returns the
 * method, or null (the normal classifier path). Pure.
 */
/**
 * hasHardPaymentClaim on the text with the store's own list labels read short ("Nombre completo" → "Nombre"). Verifier
 * r2 F1 / SecureDog r3 INT-G: the burst exemption forgives exactly these label false positives and nothing else.
 */
export function hasHardPaymentClaimLabelMasked(text: string): boolean {
  return hasHardPaymentClaim((text || '').replace(DATA_LABEL_MASK_RE, (l) => l.split(/\s+/)[0]))
}

export function embeddedPaymentChoice(text: string): PaymentChoiceMethod | null {
  // SecureDog r2 INT-D / r3 INT-G: invisible characters and odd breaks are rejected, never stripped (they glue words).
  if (DATA_ODD_BREAK_RE.test((text || '').normalize('NFKC')) || hasOddAccentPayWord(text || '')) return null
  const value = stripFormatChars((text || '').normalize('NFKC')).replace(/\p{Default_Ignorable_Code_Point}/gu, '')
  if (!value.trim() || value.length > DATA_CHOICE_MAX_CHARS) return null
  // Any question, any non-Latin letter (Cyrillic "Уа") or Latin look-alike (small caps "ʟɪsᴛᴏ"), any symbol / emoji
  // besides 🙏 😊 🙌, any letter-spaced word ("l i s t o").
  if (/[?¿]/u.test(value) || /(?=\p{L})\P{Script=Latin}/u.test(value) || DATA_LATIN_LOOKALIKE_RE.test(value)) return null
  if (DATA_SPACED_LETTERS_RE.test(value)) return null
  if (/[\p{So}\p{Extended_Pictographic}]/u.test(value.replace(DATA_CHOICE_EMOJI_RE, ''))) return null
  const masked = value.replace(DATA_LABEL_MASK_RE, (l) => l.split(/\s+/)[0])
  const folded = foldChoice(masked)
  const collapsed = folded.replace(/(\p{L})\1+/gu, '$1')
  for (const v of [masked, folded, collapsed]) {
    if (DATA_CHOICE_REJECT_RE.test(v) || CHOICE_CLAIM_WORD_RE.test(v) || PAYMENT_COMPLETION_RE.test(v) || STATUS_DISPUTE_RE.test(foldChoice(v))) return null
    if (PARTIAL_STATE_RE.test(v) || DEBT_RE.test(v) || hasPaymentStatusHint(v) || hasChoiceClaimOrStatusWord(v)) return null
  }
  if (
    SENT_AMOUNT_CLAIM_RE.test(masked) ||
    PROOF_CUE_RE.test(masked) ||
    hasPaymentClaimCue(masked) ||
    CONFIRM_CUE_RE.test(masked) ||
    CONFIRM_PAYMENT_RE.test(masked) ||
    RISK_CUE_RE.test(masked) ||
    hasPaymentStatusClaim(masked) ||
    NARROW_STATUS_QUESTION_RE.test(masked) ||
    isPaymentCompletionClaim(masked) ||
    // SecureDog r2 INT-A: additive, never a replacement — every input the live classifier hands off as a hard claim
    // stays a hand-off (on the label-masked text: "Nombre completo" is not "completo").
    hasHardPaymentClaim(masked) ||
    // Start-bounded here: an address has "centro" / "Concepción" (the plain list also matches inside words).
    DATA_STATUS_CUE_RE.test(masked)
  ) {
    return null
  }
  const parts = masked
    .split(/\n+|(?<=[.!;])\s+/u)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > DATA_CHOICE_MAX_PARTS) return null
  let method: PaymentChoiceMethod | null = null
  const dataParts: string[] = []
  for (const part of parts) {
    const label = PAY_LABEL_LINE_RE.exec(part.replace(/[\s.!,;]+$/u, ''))
    const comma = part.lastIndexOf(',')
    // The part itself, the value of "Forma de pago: …", or a trailing ", pago por SINPE" after order data.
    const candidates: Array<[string, string]> = [[part, '']]
    if (label) candidates.push([label[1], ''])
    if (comma > 0) candidates.push([part.slice(comma + 1), part.slice(0, comma)])
    let matched = false
    for (const [choicePart, rest] of candidates) {
      const g = paymentChoiceGrammar(choicePart.trim())
      if (!g) continue
      if (g.ask || (method && method !== g.method)) return null
      if (rest && !isOrderDataPart(rest)) continue
      method = g.method
      if (rest) dataParts.push(rest)
      matched = true
      break
    }
    if (matched) continue
    if (!isOrderDataPart(part)) return null
    dataParts.push(part)
  }
  if (method && dataParts.length && hasFreePayAct(dataParts.join('\n'))) return null
  return method
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
