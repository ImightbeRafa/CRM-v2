/**
 * Output policy for every AI-originated text: model, shortcuts, handoffs, appends.
 * Monetary amounts must match an authorized provenance class.
 */

import { extractShortcutTag } from '@/lib/soft-ai/reply-images'
import {
  purchaseSummaryRenderable,
  shippingProvenanceAmounts,
  type BrandFacts,
  type ReplyStyle,
  DEFAULT_REPLY_STYLE,
} from '@/lib/soft-ai/brand-facts'
import {
  confirmationCheckForms,
  hasOutboundConfirmationClaim,
  hasUnsafeLetters,
  maskConditionalConfirmation,
  normalizeForConfirmationCheck,
  renderShortcutTemplate,
  shortcutByKey,
  stripBidiControls,
  type RuntimeShortcut,
} from '@/lib/soft-ai/shortcuts'
import type { AgentIntent } from '@/lib/soft-ai/agent-intents'
import { fillPaymentToken, paymentNumberProblems, type PaymentFillOptions, type TokenPaymentMethod } from '@/lib/soft-ai/payment-guard'
import { hasPaymentWord, invisibleAsGap, mentionsConfirmVerb } from '@/lib/soft-ai/payment-classifier'
import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'
import { buildLinkAllowlist, foreignLinks, type LinkAllowlist } from '@/lib/soft-ai/links'
import { canonicalizeOrderDataList, SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'
import { MAX_REPLY_PARTS, splitReplyParts } from '@/lib/soft-ai/reply-parts'
import { dataListBeforePaymentQuestion } from '@/lib/soft-ai/sales-state'
import { stockProblems, type StockGuard } from '@/lib/soft-ai/product-availability-core'

/**
 * Backstop for short payment confirmations the confirmation-wording check misses ("Sí, ya se acreditó", "Sí, lo
 * recibimos", "Todo en orden con tu sinpe"): to a message that mentions a payment, such a reply is never sent and the
 * chat goes to a person (SecureDog INT-93). Delivery wording ("te llega en 2 a 4 días") is not matched.
 */
const PAYMENT_STATUS_REPLY_RE =
  /(acredit|se\s+aplic|aplicad[oa]|reflej|cay[oó]\s+(?:perfecto|bien)|entr[oó]\s+(?:perfecto|bien)|todo\s+correcto|(nos|me|les)\s+(lleg|entr|cay)[oó]|ya\s+(nos\s+|me\s+|les\s+)?(lleg|entr|cay)[oó]|recibimos|recibido|lo\s+vimos|la\s+vimos|lo\s+tenemos|todo\s+en\s+orden|est[aá]\s+en\s+orden|es\s+correct[oa]|est[aá]\s+confirmad[oa]|qued[oó]\s+(pagad|confirmad)|lleg[oó]\s+bien|todo\s+(bien|listo|sali[oó])|ya\s+est[aá](?![\p{L}])|ya\s+se\s+hizo|(ning[uú]n|sin)\s+problema|list[oa]\s+(tu|el|su)\s+pago|(?<![\p{L}])(?:est[aá]|qued[oó]|sali[oó]|todo)\s+(?:ok|okay|okey|oki)(?![\p{L}])|(?:tu|el|su)\s+pago\s+(?:\p{L}+\s+)?(?:ok|okay|okey)(?![\p{L}])|(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)\s+(?:\p{L}+\s+){0,2}(?:entr[oó]|cay[oó]|lleg[oó]|est[aá]\s+(?:bien|correct|list)|qued[oó]\s+list|fue\s+recibid)|(?:ya\s+(?:lo\s+|la\s+)?(?:vimos|revisamos|verificamos|confirmamos)|(?<![\p{L}])vimos)\s+(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)|est[aá]\s+correct[oa])/iu

/**
 * Verifier r3 #3: the "it arrived / it's done" subset, for replies to a bare confirm ask ("¿me confirmás?"): "¡Sí, nos
 * llegó!", "¡Perfecto, ya está!", "todo en orden", "recibido", "lo vimos". Never "sin problema" / "lo tenemos" / "es
 * correcto" (ordinary sales answers there). "ya está" only at the end of a sentence ("ya está disponible" is a stock fact).
 */
const CONFIRM_ASK_STATUS_REPLY_RE =
  /(?<![\p{L}])(?:(?:nos|me|les|ya)\s+(?:lleg|entr|cay)[oó]|lleg[oó]\s+(?:bien|perfecto)|(?:entr|cay)[oó]\s+(?:bien|perfecto)|recibid[oa]s?|recibimos|acredit\p{L}*|reflej\p{L}*|(?:lo|la)\s+vimos|(?:lo|la)\s+vi|ya\s+(?:lo|la)\s+tenemos|vimos\s+(?:tu|su|el)|todo\s+en\s+orden|est[aá]\s+en\s+orden|todo\s+(?:bien|listo|correcto)|qued[oó]\s+(?:pagad|confirmad|registrad)\p{L}*|est[aá]\s+confirmad[oa]|ya\s+se\s+hizo|ya\s+est[aá](?=\s*(?:[.!,🙌😊👍💚❤✨]|$))|(?:ya\s+)?(?:lo|la)\s+revisamos|registrad[oa]|te\s+confirmo|(?:ya\s+)?est[aá]\s+list[oa]|todo\s+perfecto)(?![\p{L}])|^\s*[¡!]*\s*s[ií]\s*[!.,🙌😊👍💚❤✨\s]*$/iu
/** Verifier r7 #2: the agent asks the customer for something (an imperative ask, or the data list). */
const DIRECT_ASK_RE =
  /(?<![\p{L}])(?:contame|cont[aá]nos|decime|dec[ií]nos|pasame|p[aá]same|mandame|m[aá]ndame|escribime|indicame|ind[ií]came|regalame|reg[aá]lame|cu[eé]ntame|dime|env[ií]ame)(?![\p{L}])|nombre\s+completo/iu
/** SecureDog r3 INT-169: a reply that is ONLY an affirmation ("¡Claro que sí!", "¡Hecho!", "Correcto 👍", "Sí, claro"). */
const AFFIRM_ONLY_RE =
  /^[\s¡!.,]*(?:(?:s[ií]|claro|que|perfecto|list[oa]|hecho|por\s+supuesto|correct[oa]|ok|okay|dale|exacto|confirmad[oa]|todo|bien|genial|excelente|de\s+una)[\s¡!.,]*)+$/iu
/** SecureDog r2 INT-167 (pre-existing): "¿Les llegó?", "¿Lo recibieron?", "¿Les cayó?" — a payment status question. */
const STATUS_QUESTION_RE =
  /(?<![\p{L}])(?:(?:les|le|te|nos)\s+(?:lleg|cay|entr)[oó]|(?:lo|la)\s+(?:recibieron|recibi[oó]|vieron|vio))(?![\p{L}])|^[\s¿¡]*(?:y\s+)?ya\s+est[aá]\s*[?!.]*\s*$/iu

/** Never said by the agent in any chat: it cannot see the bank ("acreditado", "recibimos tu sinpe", "pago verificado"). */
const ALWAYS_PAYMENT_STATUS_REPLY_RE =
  /(?<![\p{L}])(?:(?:tu|su|el)\s+(?:sinpe|pago|dep[oó]sito|transferencia)\s+ya\s+(?:cay[oó]|lleg[oó]|entr[oó])|ya\s+nos\s+(?:lleg|cay|entr)[oó](?=\s*(?:[.!🙌😊👍💚❤✨]|$|,\s*(?:muchas\s+)?gracias))|acredit\p{L}*|(?:recibimos|ya\s+recibimos|verificamos|validamos|confirmamos|ya\s+vimos|vimos|ya\s+vi|vi)\s+(?:tu|su|el)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)|(?:pago|sinpe|dep[oó]sito|transferencia)\s+(?:recibid[oa]|confirmad[oa]|verificad[oa]|validad[oa]|acreditad[oa]|aprobad[oa])|(?:tu|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia)\s+(?:ya\s+)?(?:est[aá]|qued[oó]|fue)\s+(?:recibid|confirmad|verificad|validad|acreditad|aprobad|procesad|registrad)\p{L}*)(?![\p{L}])/iu

/**
 * SecureDog INT-158 M1 / M2 (wave 2026-10-22): done-claims the model writes unprompted that the lists above missed —
 * English / Portuguese / French ("Payment received", "Your order has shipped"), "gracias por tu pago / por pagar",
 * "Pagado ✅" / "todo pagado", "pago completado / procesado / exitoso", "confirmo que pagaste", "ya tenemos tu plata",
 * "pedido enviado / despachado". Held on every reply (the prompt answers in Spanish and never claims a payment).
 */
const MORE_DONE_REPLY_RE =
  /(?<![\p{L}])(?:payment\s+(?:has\s+been\s+|was\s+|is\s+)?(?:received|confirmed|approved|processed|completed|verified)|(?:we|i)\s+(?:have\s+|'ve\s+)?(?:got|received|confirmed|verified)\s+(?:your|the)\s+(?:payment|transfer|deposit|money)|(?:your\s+)?order\s+(?:has\s+)?(?:shipped|been\s+(?:sent|shipped|dispatched)|is\s+on\s+(?:its|the)\s+way)|(?:pagamento|paiement)\s+(?:recebido|confirmado|aprovado|re[cç]u|confirm[eé])|gracias\s+por\s+(?:tu\s+|su\s+|el\s+|la\s+)?(?:pago|pagar|sinpe|transferencia|dep[oó]sito)|(?:el\s+equipo\s+|ya\s+)(?:confirm[oó]|verific[oó]|aprob[oó]|valid[oó])\s+(?:tu|su|el)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)|(?:ya\s+)?(?:confirmaron|verificaron|aprobaron|validaron|acreditaron)\s+(?:tu|su|el)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)|(?:el\s+equipo\s+)?ya\s+(?:lo|la)\s+(?:confirm[oó]|confirmaron|verific[oó]|verificaron|aprob[oó]|aprobaron|valid[oó]|validaron|acredit[oó]|acreditaron)|(?:lo|la)\s+(?:confirm[oó]|verific[oó]|aprob[oó]|valid[oó])\s+el\s+equipo|(?:tu|su|el)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)\s+(?:ya\s+)?(?:se\s+(?:confirm[oó]|verific[oó]|aprob[oó]|valid[oó]|acredit[oó])|(?:lo|la)\s+(?:confirm[oó]|verific[oó]|aprob[oó]|valid[oó]))|se\s+(?:confirm[oó]|verific[oó]|aprob[oó]|valid[oó]|acredit[oó])\s+(?:tu|su|el)\s+(?:pago|sinpe|dep[oó]sito|transferencia)|confirmo\s+que\s+(?:ya\s+)?(?:pagaste|pag[oó]|hiciste\s+el\s+(?:pago|sinpe))|ya\s+tenemos\s+(?:tu|la|su)\s+plata|(?:tu\s+|su\s+|el\s+)?pedido\s*:?\s+(?:ya\s+)?(?:fue\s+)?(?:enviado|despachado)(?=\s*(?:[.!,]|\p{Extended_Pictographic}|$)))(?![\p{L}])/iu

/**
 * SecureDog wave D r2 (INT-208): "pagado" / "pago completado · procesado · exitoso" as a statement, per sentence, with
 * targeted exceptions instead of line anchors: a question, a pay-in-advance / "dejar … pagado" offer, a conditional
 * ("si / cuando / con / una vez / tengamos …" before it), "Pagado el pedido, …" (a participle clause), and
 * "procesado por / es / te llega" (a description of the payment page).
 */
// SecureDog r3 #5: "Pagado el pedido" is excused only as a participle clause followed by a comma ("Pagado el pedido, sale…").
const PAID_WORD_RE =
  /(?<![\p{L}])pagad[oa](?![\p{L}])(?!\s+(?:(?:el|la|los|las)\s+\p{L}+(?:\s+\p{L}+)?\s*,|(?:por\s+adelantado|antes|despu[eé]s|al|en\s+la|a\s+tiempo)(?![\p{L}])))/iu
const PAY_DONE_RE = /(?<![\p{L}])pago\s+(?:(?:fue|ha\s+sido|ya\s+fue|qued[oó]|est[aá])\s+)?(?:completado|procesado|exitoso)(?![\p{L}])(?!\s+(?:por\s+(?:tilopay|la\s+(?:p[aá]gina|web|plataforma)|el\s+banco|medio)|es|te\s+llega|con\s+tilopay)(?![\p{L}]))/iu
// SecureDog r3 #5: an excuse counts only when it governs the claim (at most 2 words between, no comma).
const PAID_EXCUSE_RE =
  /(?<![\p{L}])(?:dej\p{L}*|adelantad\p{L}*|al\s+recibir|si|cuando|apenas|con|una\s+vez(?:\s+que)?|tengamos|tengas|tenga|despu[eé]s\s+de|hasta\s+que|para\s+que|antes\s+de|tiene\s+que|debe|hay\s+que)(?:\s+\p{L}+){0,2}\s*$/iu
/**
 * Verifier r3 #6: "pagado" needs a done marker ("ya / está / quedó / fue / todo / lo tenés … pagado") or must be the whole
 * sentence ("¡Pagado!", "Pagado, gracias") — policy lines ("tiene que estar pagado", "Todo pedido pagado hoy sale…",
 * "El envío va pagado en el precio", "se entrega pagado") are not claims.
 */
const PAID_DONE_MARK_RE =
  /(?<![\p{L}])(?:ya\s+(?:est[aá]\s+|estaba\s+|qued[oó]\s+|fue\s+)?(?:todo\s+)?|est[aá]\s+(?:todo\s+)?|estaba\s+(?:todo\s+)?|qued[oó]\s+(?:todo\s+)?|fue\s+|todo\s+|(?:lo|la)\s+ten[eé]s\s+)pagad[oa](?![\p{L}])/iu
const PAID_ALONE_RE =
  /^[\s\p{P}*_~]*(?:(?:s[ií]|listo|ok|perfecto|claro|gracias)[\s,.!¡]+)?pagad[oa](?:\s+(?:el|la)\s+\p{L}+)?[\s\p{P}*_~]*(?:(?:muchas\s+)?gracias|listo)?[\s\p{P}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Default_Ignorable_Code_Point}]*$/iu
function hasPaidStatement(forms: string[]): boolean {
  return forms.some((form) =>
    // SecureDog r3 #5: "¿" starts a new sentence ("Todo pagado ¿Algo más?" judges "Todo pagado").
    form.split(/(?<=[.!?\n])|(?=¿)/u).some((seg) => {
      if (/[?¿]/u.test(seg)) return false
      const paid = PAID_WORD_RE.exec(seg)
      const m = paid && (PAID_DONE_MARK_RE.test(seg) || PAID_ALONE_RE.test(seg)) ? paid : PAY_DONE_RE.exec(seg)
      return Boolean(m) && !PAID_EXCUSE_RE.test(seg.slice(0, m!.index))
    }),
  )
}

/**
 * SecureDog wave D r2 (M1): the prompt answers in Spanish only — a reply that reads as English / Portuguese / French is
 * never sent as is. Counted on function words (brand names and links carry none).
 */
const FOREIGN_WORD_RE =
  /(?<![\p{L}])(?:the|you|your|we|our|is|are|has|have|been|it|it's|its|got|thanks|thank|received|yes|order|payment|paid|pay|paying|went|through|shipped|confirmed|seu|sua|voc[eê]|obrigad[oa]|recebemos|pagamento|nous|avons|votre|vous|merci|paiement|re[cç]u)(?![\p{L}])/giu
const SPANISH_WORD_RE =
  /(?<![\p{L}])(?:de|la|el|que|tu|te|por|con|para|es|en|y|los|las|un|una|s[ií]|gracias|hola|pedido|pago|env[ií]o|precio|est[aá]|ya|lo|le|me|mi|tenemos|pod[eé]s|quer[eé]s)(?![\p{L}])/giu
/** The words a language check reads: no links, no Title Case brand runs ("Thank You Farmer Sun Project"). */
/**
 * SecureDog r4 (M1 reply side): with payment in play a Title Case run is a name only when it is the store's own (it appears
 * in the brand facts / catalog text, `ownNames`) — "Your Order Is Confirmed" / "Payment Went Through" are not names.
 */
const TITLE_FUNCTION_WORD_RE = /(?<![\p{L}])(?:your|you|is|was|has|been|for|thank|thanks|order|payment|went|through|the|we|our|it|confirmed|received)(?![\p{L}])/iu
function languageWords(text: string, ownNames?: string | null): string {
  const noLinks = (text || '').replace(/\S*(?:https?:\/\/|www\.)\S*/giu, ' ')
  const own = ownNames == null ? null : ownNames.toLowerCase()
  return noLinks.replace(/(?<![\p{L}])\p{Lu}[\p{L}']*(?:\s+\p{Lu}[\p{L}']*)+/gu, (run) => {
    if (own === null) return ' '
    // Verifier final: a product name ("Done Patch", "Yes To Tomatoes") has no English function word; a sentence written
    // in Title Case ("Your Order Is Confirmed", "Payment Went Through", "Thank You For Your Payment") does.
    if (!TITLE_FUNCTION_WORD_RE.test(run)) return ' '
    // A sentence-start article is not part of the name ("El Done Patch").
    const lower = run.toLowerCase().replace(/^(?:el|la|los|las|un|una|mi|tu|su|nuestro|nuestra)\s+/u, '')
    const lead = lower.split(/\s+/u).slice(0, 2).join(' ')
    return own.includes(lower) || own.includes(lead) ? ' ' : run
  })
}
export function readsAsForeignLanguage(text: string, ownNames?: string | null): boolean {
  // Verifier r3 #8: words inside links and Title Case brand runs ("Thank You Farmer Sun Project") are not the language.
  const words = languageWords(text, ownNames)
  const foreign = new Set((words.match(FOREIGN_WORD_RE) ?? []).map((w) => w.toLowerCase())).size
  if (foreign < 2) return false
  return foreign > (words.match(SPANISH_WORD_RE) ?? []).length
}

/**
 * SecureDog wave D r2 (INT-202 residual): to a payment status question, a reply that STARTS with a yes ("Sí ✓", "Siii",
 * "Sip", "Ajá", "¡Así es!", "Efectivamente", "Yes", "¡Sí! ¿Algo más?") reads as "your payment is fine" — unless it hands
 * the check to the team ("el equipo lo revisa", "te confirmo apenas lo vea").
 */
// SecureDog r3 #2: filler words before the yes ("Mmm sí", "Pues sí", "Jaja sí", "¡Gracias! Sí", "¡De una!").
const AFFIRM_START_RE =
  /^[\s¡!¿*_~"'«(\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Default_Ignorable_Code_Point}]*(?:(?:m+h*m+|pues|este|ja(?:ja)+|je(?:je)+|ay|bueno|mae|diay|gracias|muchas\s+gracias|ok|okay)[\s,.!¡]+)*(?:s[ií]+p?|de\s+una|claro|aj[aá]|as[ií]\s+es|efectivamente|afirmativo|de\s+fijo|pura\s+vida|yes|yep|yeah|yup|correct[oa]|exact[oa]|perfecto|list[oa]|hecho|ok|okay|okey|dale|genial|excelente|confirmad[oa]|todo\s+bien|por\s+supuesto|got\s+it|sure)(?![\p{L}])/iu
/**
 * A PENDING hand-over to the team ("el equipo lo revisa", "lo va a revisar", "te confirmo apenas lo vea", "un momento").
 * SecureDog r3 #2: never when the reply also says it is done ("el equipo ya lo confirmó", "ya lo verificamos").
 */
const PENDING_DEFER_RE =
  /(?<![\p{L}])(?:(?:lo|la)\s+(?:revisa|revisan|verifica|verifican|confirma|confirman)|(?:lo|la)\s+va(?:n|mos)?\s+a\s+(?:revisar|verificar|confirmar)|(?:te|le)\s+(?:confirma|confirman|confirmo|aviso|avisamos|escribe|escriben)|un\s+momento|ya\s+te\s+(?:aviso|confirmo|escribo))(?![\p{L}])/iu
const COMPLETED_CHECK_RE =
  /(?<![\p{L}])(?:ya\s+(?:lo\s+|la\s+|le\s+)?(?:\p{L}+(?:ó|aron|amos|ado|ada|ido|ida)|vio|vieron|vimos)|(?:revis|verific|confirm|aprob|valid)(?:ó|aron|ado|ada))(?![\p{L}])/iu
const DEFERS_TO_TEAM_RE = { test: (text: string) => PENDING_DEFER_RE.test(text) && !COMPLETED_CHECK_RE.test(text) }
/** Verifier r3 residual: a yes first is held even with "un momento / mi compañera te escribe" after it (a person decides). */
function startsWithAffirmation(text: string): boolean {
  return [text, normalizeForConfirmationCheck(text)].some((t) => AFFIRM_START_RE.test(t))
}

/** INT-202: a bare affirmation read through markup, soft hyphens, emoji modifiers / joiners and text emoticons. */
function isAffirmOnly(text: string): boolean {
  const clear = (t: string) =>
    t.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Default_Ignorable_Code_Point}\p{M}]/gu, ' ').replace(/(?<![\p{L}\d])(?:[:;=]-?[)D(pP]|<3|xD)(?![\p{L}\d])/gu, ' ')
  // An emoji / emoticon-only reply ("👍🏽", ":)") to a status question is a yes too.
  return [text, normalizeForConfirmationCheck(text)].some((t) => AFFIRM_ONLY_RE.test(clear(t)) || (t.trim() !== '' && !/[\p{L}\d?¿]/u.test(clear(t))))
}

/** INT-201: a payment status question in either reading of the customer's text (invisible characters as gaps too). */
function isStatusQuestion(customerText: string): boolean {
  const gapped = invisibleAsGap(customerText)
  // SecureDog wave D r2 (INT-206): the burst joins bubbles with "\n" — "¿Ya está?" is judged per bubble.
  return [customerText.normalize('NFKC'), ...(gapped !== null ? [gapped] : [])].some((t) =>
    stripFormatChars(t)
      .split('\n')
      .some((line) => STATUS_QUESTION_RE.test(line)),
  )
}

/**
 * Verifier r3 #4: the two wave-D holds (a yes first / no question in the reply) apply only to a PAYMENT status question
 * bubble — "¿Ya está?" alone, or a short "¿Les llegó? / ¿Lo recibieron?" / one with a payment noun. Never a story bubble
 * ("Mi hermana lo vio en Instagram", "¿Te llegó mi mensaje de ayer?").
 */
const PAY_NOUN_IN_BUBBLE_RE = /(?<![\p{L}])(?:pag\p{L}*|plata|dinero|sinpe\p{L}*|transfer\p{L}*|dep[oó]sit\p{L}*|comprobante|monto)(?![\p{L}])/iu
/**
 * SecureDog r3 #1: with payment in play, a short question made only of status words ("¿Ya quedó?", "¿Todo bien?", "¿Entró?",
 * "¿Sí llegó?", "¿Ya se reflejó?", "¿Lo tienen?", "¿Y?", "Hola, ¿ya está?", "Ya te lo envié, ¿todo bien?") is a status
 * question too. Judged on the question clause only; any product / price / other word keeps it a sales question.
 */
const STATUS_WORDS = new Set(
  'ya y o sí si se lo la le les me te nos todo bien está esta estaba listo lista quedó quedo entró entro llegó llego cayó cayo pasó paso salió salio funcionó funciono reflejó reflejo recibieron recibió recibio vieron vio gracias ok okay porfa el pago sinpe plata dinero comprobante transferencia depósito deposito'.split(
    ' ',
  ),
)
const STATE_VERBS = new Set('quedó quedo entró entro llegó llego cayó cayo pasó paso salió salio funcionó funciono reflejó reflejo recibieron recibió recibio vieron vio estaba'.split(' '))
function isShortStatusClause(line: string): boolean {
  const q = line.lastIndexOf('?')
  if (q < 0) return false
  const head = line.slice(0, q)
  const clause = head.slice(Math.max(head.lastIndexOf('¿'), head.search(/[^.,!¡]*$/u), 0)).replace(/^¿/u, '')
  const words = (clause.toLowerCase().match(/\p{L}+/gu) ?? []).filter(Boolean)
  // Verifier r4 #1: a state verb in the clause, or one of the exact short forms (never "¿Lo tienen?", "¿Hola?", "¿Así está bien?").
  const joined = words.join(' ')
  const stateVerb = words.some((w) => STATE_VERBS.has(w)) || /^(?:ya\s+)?(?:est[aá](?:\s+(?:list[oa]|todo\s+bien|bien))?|todo\s+bien|y|ya|list[oa])$/u.test(joined)
  return words.length > 0 && words.length <= 5 && stateVerb && words.every((w) => STATUS_WORDS.has(w))
}
function isPaymentStatusQuestion(customerText: string, paymentInPlay = false): boolean {
  const gapped = invisibleAsGap(customerText)
  return [customerText.normalize('NFKC'), ...(gapped !== null ? [gapped] : [])].some((t) =>
    stripFormatChars(t)
      .split('\n')
      .some(
        (line) =>
          /[?¿]/u.test(line) &&
          ((STATUS_QUESTION_RE.test(line) && (PAY_NOUN_IN_BUBBLE_RE.test(line) || (line.match(/\p{L}+/gu) ?? []).length <= 4)) ||
            /(?<![\p{L}])ya\s+est[aá]\s*\?/iu.test(line) ||
            (paymentInPlay && isShortStatusClause(line))),
      ),
  )
}

/**
 * SecureDog r4 (INT-206) / Verifier final: a customer question clause of at most 6 words with no product / price /
 * shipping / store word ("¿Ya se acreditó?", "¿Todo en orden?", "¿Novedades?", "¿Lo pudieron ver?") — the shape a
 * payment-status question takes; "¿Cuánto cuesta el de dormir?" / "¿Tienen talla M?" are sales questions.
 */
const SALES_QUESTION_WORD_RE =
  /(?<![\p{L}])(?:precio|cu[aá]nto|cuesta|cuestan|vale|valen|talla|tallas|color|colores|env[ií]o|env[ií]os|envían|tienen|tiene|hay|stock|disponible|producto|productos|combo|paquete|paquetes|modelo|tama[nñ]o|sabor|sabores|direcci[oó]n|ubicaci[oó]n|horario|tienda|retiro|retirar|garant[ií]a|devoluci[oó]n|usa|dosis|ingredientes|sirve|funciona\s+para|descuento|promo|oferta|llega\s+a|entregan|cuándo\s+llega|cu[aá]ndo\s+llega)(?![\p{L}])/iu
/**
 * SecureDog (on 77daecdf): at any length, a question about what the customer SENT ("¿Pudieron ver lo que les mandé hace
 * rato?", "¿Será que ya les apareció lo que les mandé?") or a see / arrive / show-up verb about it is status-shaped;
 * so are "¿Ya hay algo?" / "¿Ya sirve?".
 */
const SENT_THING_QUESTION_RE =
  /(?<![\p{L}])(?:(?:lo|la)\s+que\s+(?:les?|te)\s+(?:mand[eé]|envi[eé]|pas[eé]|hice|deposit[eé]|transfer[ií])|(?:pudieron|pudiste|pudo|podr[ií]an|alcanzaron)\s+(?:ver|revisar|verificar|confirmar)|(?:ya\s+)?(?:les?|te)\s+(?:apareci[oó]|aparece|lleg[oó]|cay[oó]|entr[oó]|refleja|reflej[oó])|ya\s+(?:hay\s+algo|sirve|apareci[oó]|aparece|lo\s+vieron|lo\s+revisaron))(?![\p{L}])/iu
function hasShortStatusShapedQuestion(customerText: string): boolean {
  return customerText.split('\n').some((line) => {
    const q = line.lastIndexOf('?')
    if (q < 0) return false
    const head = line.slice(0, q)
    const clause = head.slice(Math.max(head.lastIndexOf('¿'), head.search(/[^.,!¡]*$/u), 0))
    if (SENT_THING_QUESTION_RE.test(clause)) return true
    const words = clause.match(/\p{L}+/gu) ?? []
    return words.length > 0 && words.length <= 6 && !SALES_QUESTION_WORD_RE.test(clause)
  })
}

/**
 * SecureDog r3 #3: with payment in play, one English / PT / FR status word in the reply is enough to hold it ("Done",
 * "Confirmed", "Received", "Perfecto, received", "Tudo certo", "C'est bon", "Reçu").
 */
const FOREIGN_STATUS_WORD_RE =
  /(?<![\p{L}])(?:done|confirmed|received|paid|through|sure|yes|yep|yeah|approved|verified|completed|success|successful|arrived|perfect|chegou|recebi|aprovado|all\s+set|all\s+good|certo|recebido|re[cç]u|fait|c['’]est\s+bon|tudo\s+certo|pagamento\s+ok|payment\s+ok)(?![\p{L}])/iu

export type OutputValidationResult = {
  ok: boolean
  needsHuman: boolean
  reasons: string[]
  highlightedAmounts?: number[]
}

export type AuthorizedAmountSource = 'inventory' | 'shipping' | 'quote'

// "¢" (U+00A2) is written for the colón too (SecureDog INT-104).
const MONEY_RE = /[₡¢$]\s?\d|\d[\d.,]*\s*(colones|crc|usd)/i
/** Deals the agent may never invent (fixed rule 12, INT-72): discounts, promos, free shipping, gifts, "te lo dejo en". */
const DEAL_RE =
  // No bare "gratis" / "%" (free pickup, "100% algodón" are fine); deal phrasing only.
  /(?<![\p{L}])(descuentos?|promoci[oó]n(es)?\s+especial|oferta\s+especial|precio\s+especial|rebaj\p{L}*|env[ií]os?\s+(gratis|gratuitos?|sin\s+costo|de\s+regalo|por\s+la\s+casa)|(sale|va|queda)\s+gratis\s+el\s+env[ií]o|dos\s+por\s+uno|tres\s+por\s+dos|mitad\s+de\s+precio|medio\s+precio|te (lo|la|los|las) (dejo|rebajo|regalo)|te regalo|de regalo|por la casa|sin cobrarte|te hago (un )?precio|2x1|3x2|\d{1,2}\s?%\s*(de\s+)?(descuento|off|menos))(?![\p{L}])/iu
const DEAL_ALL_RE = new RegExp(DEAL_RE.source, 'giu')
const FREE_SHIPPING_DEAL_RE = /^(env[ií]os?\s+(gratis|gratuitos?|sin\s+costo)|(sale|va|queda)\s+gratis\s+el\s+env[ií]o)$/iu
const SPECIAL_PRICE_DEAL_RE = /^(precio\s+especial|promoci[oó]n(es)?\s+especial|oferta\s+especial)$/iu

/**
 * Every way of saying "you don't pay shipping" (SecureDog INT-86): free, included, "no te cobro el envío", ₡0, on us,
 * "te lo mando gratis". "Más el envío" / "retiro sin costo" are not matches. Negated forms ("el envío no es gratis")
 * are dropped in freeShippingWording.
 */
const FREE_SHIPPING_WORDING_RE = new RegExp(
  [
    'env[ií]os?\\s+(?:\\p{L}+\\s+){0,2}?(?:gratis|gratuitos?|sin\\s+costo|incluidos?|de\\s+regalo|por\\s+(?:la\\s+casa|nuestra\\s+cuenta|mi\\s+cuenta))',
    '(?:sale|va|queda)\\s+gratis\\s+el\\s+env[ií]o',
    'env[ií]o\\s+corre\\s+por\\s+(?:nuestra|mi)\\s+cuenta',
    'incluye(?:n)?\\s+(?:el\\s+)?env[ií]o',
    'no\\s+(?:te\\s+|le\\s+|les\\s+)?(?:cobr\\p{L}*|pag\\p{L}*)\\s+(?:el\\s+|nada\\s+de\\s+|nada\\s+por\\s+el\\s+)?env[ií]o',
    'sin\\s+(?:cargo|costo|cobro)\\s+(?:de|por|del)\\s+env[ií]o',
    'env[ií]o\\s*[:(]?\\s*(?:[₡¢]\\s?0(?![\\d.,])|gratis)',
    'te\\s+(?:lo|la|los|las)\\s+(?:mando|env[ií]o|llevo)\\s+gratis',
    // INT-92: more ways to say it.
    'env[ií]o\\s+(?:no\\s+tiene|sin)\\s+(?:ning[uú]n\\s+)?(?:costo|cargo|cobro)',
    '(?:te|se|le|les)\\s+(?:lo|la|los|las)\\s+(?:mand|envi|env[ií]|llev|despach)\\p{L}*\\s+gratis',
    'gratis\\s+(?:el|la)\\s+(?:env[ií]o|entrega|despacho)',
    '(?:entrega|despacho|delivery)\\s+(?:\\p{L}+\\s+){0,2}?(?:gratis|gratuit\\p{L}*|sin\\s+costo|incluid\\p{L}*)',
    'sin\\s+(?:costo|cargo|cobro)\\s+(?:el|del|de|por)\\s+(?:env[ií]o|entrega|despacho)',
    'no\\s+se\\s+(?:cobr|pag)\\p{L}*\\s+(?:el\\s+)?(?:env[ií]o|entrega|despacho)',
    'env[ií]o\\s+(?:\\p{L}+\\s+){0,3}?[₡¢]\\s?0(?![\\d.,])',
    'por\\s+cuenta\\s+nuestra',
    'free\\s+(?:shipping|delivery)',
  ].map((p) => `(?:${p})`).join('|'),
  'giu',
)
const NEGATED_FREE_SHIPPING_RE = /(?<![\p{L}])no(?![\p{L}])\s+(?:es|va|sale|queda|est[aá]|incluye|viene)/iu

/** Free-shipping phrases in a text (with their position), negations removed. */
export function freeShippingWording(text: string): Array<{ index: number; end: number; phrase: string }> {
  const out: Array<{ index: number; end: number; phrase: string }> = []
  for (const m of text.matchAll(FREE_SHIPPING_WORDING_RE)) {
    const phrase = m[0]
    if (NEGATED_FREE_SHIPPING_RE.test(phrase) && !/^no\s/i.test(phrase)) continue
    out.push({ index: m.index ?? 0, end: (m.index ?? 0) + phrase.length, phrase })
  }
  return out
}

/**
 * Deal wording is blocked unless the owner's active promo enables that exact kind (B1): free shipping and a special
 * price can be enabled; discounts, %, 2x1, "te lo dejo en", gifts are always blocked.
 */
/**
 * Lane C D6: the store saying it has NO discount ("No manejamos descuentos", "no tenemos promociones ni descuentos",
 * "sin descuento") is not an offer. Closed shape: a negation, an optional "we have / there is" verb and an article right
 * before the word, in the same clause — "no olvidés que hay descuento" is still an offer.
 */
const NEGATED_DEAL_BEFORE_RE =
  /(?:^|[^\p{L}])(?:no|ni|tampoco|sin|nunca)\s+(?:(?:manejamos|tenemos|hay|ofrecemos|damos|aplicamos|hacemos|incluimos|contamos\s+con|existen?|est[aá]n\s+disponibles)\s+)?(?:(?:ning[uú]n|ninguna|ningunos|ningunas|el|la|los|las|un|una|unos|unas|otros?|otras?)\s+)?$/iu
const NEGATABLE_DEAL_RE = /^(?:descuentos?|rebaj\p{L}*|promoci[oó]n(?:es)?\s+especial|oferta\s+especial|precio\s+especial)$/iu

function negatedDeal(text: string, index: number, phrase: string): boolean {
  if (!NEGATABLE_DEAL_RE.test(phrase)) return false
  const before = text.slice(Math.max(0, index - 60), index)
  const clause = before.slice(Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'), before.lastIndexOf(';')) + 1)
  // "No tenemos promociones ni descuentos": the earlier listed deal sits between the verb and "ni".
  return NEGATED_DEAL_BEFORE_RE.test(clause) || /(?:^|[^\p{L}])(?:no|sin|tampoco)\s+(?:\p{L}+\s+){1,4}ni\s+$/iu.test(clause)
}

export function dealProblem(text: string, allowed: ReadonlyArray<'free_shipping' | 'special_price'>): boolean {
  for (const m of text.matchAll(DEAL_ALL_RE)) {
    const phrase = m[1].trim()
    if (negatedDeal(text, m.index ?? 0, phrase)) continue
    // Free-shipping phrasing is judged below with the wider wording list.
    if (FREE_SHIPPING_DEAL_RE.test(phrase)) continue
    if (allowed.includes('special_price') && SPECIAL_PRICE_DEAL_RE.test(phrase)) continue
    return true
  }
  if (!allowed.includes('free_shipping') && freeShippingWording(text).length > 0) return true
  return false
}

/** Wording that turns a combo fact into a promise for this customer or this order. */
const FREE_SHIPPING_EXCEPTION_RE =
  /(?<![\p{L}])(aunque|pero|hoy|primera|cortes[ií]a|regal\p{L}*|por\s+esta\s+vez|esta\s+vez|igual(?:mente)?|tambi[eé]n|excepci\p{L}*|normalmente|por\s+lo\s+general|de\s+todas\s+formas|a\s+vos|a\s+ti|para\s+vos|para\s+ti|tu\s+(?:pedido|compra|orden)|califica\p{L}*|aplica\p{L}*|te\s+lo\s+(?:dejo|mando)\s+igual|te\s+(?:lo|la|los|las)\s+(?:dejo|mando))(?![\p{L}])/iu

/**
 * Combos the owner marked as including shipping (exact prices), plus words that name other things the agent sells
 * (catalog items): a clause that names one of them is not only about the included combo (INT-91).
 */
export type FreeShippingRule = {
  includedPrices: number[]
  otherNames?: string[]
  bundleWords?: string[]
  nameNotes?: string[]
  /** Pura Sonrisa P2: the store's own "envío gratis desde ₡X" threshold, with the catalog unit prices. */
  freeOver?: number
  unitPrices?: number[]
}

/**
 * Pura Sonrisa P2: the store's threshold rule said as a rule — "envío gratis desde ₡19 900", "a partir de 2 cajas",
 * "en compras desde ₡20 000", "llevando 2 cajas o más". A count N is true only when N of the CHEAPEST item already
 * reach the threshold. The clause may name no exception / personal wording ("tu pedido califica", "hoy", "a vos").
 */
const THRESHOLD_RE =
  /(?<![\p{L}])(?:desde|a\s+partir\s+de|en\s+compras?\s+(?:de|desde|mayores\s+a|sobre|de\s+m[aá]s\s+de)|por\s+compras?\s+(?:de|desde|mayores\s+a|sobre|de\s+m[aá]s\s+de)|comprando|llevando)\s+(?:(?:[₡¢]\s?(\d{1,3}(?:[.,\s ]\d{3})+|\d{4,7}))|(\d{1,2}|dos|tres|cuatro|cinco|seis)\s+(?:cajas?|unidades|productos?|paquetes?|bolsas?|frascos?|art[ií]culos?|piezas?)(?:\s+o\s+m[aá]s)?)(?![\p{L}\d])/giu
const COUNT_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }

/** Where each threshold amount the rule phrase captured starts and ends ("desde ₡25 000" → the "₡25 000" span). */
function thresholdCaptures(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const m of text.matchAll(THRESHOLD_RE)) {
    if (!m[1]) continue
    const at = (m.index ?? 0) + m[0].search(/[₡¢]/u)
    out.push([at, (m.index ?? 0) + m[0].length])
  }
  return out
}

/**
 * Verifier r3 #1 (INT-84): a clause that prices something ("Los 3 te quedan desde ₡25 000 con envío gratis", "Tenemos
 * combos desde ₡25 000…", "Precio desde…") is never the threshold rule.
 */
const THRESHOLD_PRICE_WORD_RE =
  /(?<![\p{L}])(?:quedan?|salen?|sale|cuestan?|cuesta|est[aá]n?|precios?|valen?|vale|cobr\p{L}*|combos?|kits?|packs?|paquetes?|tr[ií]os?|d[uú]os?|promo\p{L}*|llev[aá]s|te\s+(?:queda|quedan|sale|salen)|(?:los|las)\s+(?:\d+|dos|tres|cuatro|cinco|seis))(?![\p{L}])/iu

function thresholdClauseOk(clause: string, rule: FreeShippingRule): boolean {
  const over = rule.freeOver
  if (!over || FREE_SHIPPING_EXCEPTION_RE.test(clause) || THRESHOLD_PRICE_WORD_RE.test(clause)) return false
  // The rule phrase must sit right next to the free-shipping words ("envío gratis desde …", "desde … el envío es gratis").
  const near = freeShippingWording(clause).some((w) =>
    [...clause.matchAll(THRESHOLD_RE)].some((m) => {
      const s = m.index ?? 0
      const e = s + m[0].length
      return (s >= w.end && s - w.end <= 25) || (w.index >= e && w.index - e <= 25)
    }),
  )
  if (!near) return false
  // Verifier r5 note 1 (INT-84): a rule phrase BEFORE the free-shipping words reads as a price ("Es / Tenemos / Hay /
  // Va desde ₡25 000 con envío gratis") unless it is the explicit "compras / pedidos desde ₡X" shape, or only "el"
  // stands between them ("Desde ₡25 000 el envío es gratis"). Before it: nothing but a greeting.
  const firstWording = freeShippingWording(clause)[0]
  for (const m of clause.matchAll(THRESHOLD_RE)) {
    const s = m.index ?? 0
    const e = s + m[0].length
    if (!firstWording || firstWording.index < e) continue
    const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}]+/u).filter(Boolean)
    const before = fold(clause.slice(0, s))
    const between = fold(clause.slice(e, firstWording.index))
    const orderShape = /(?<![\p{L}])(?:compras?|pedidos?|[oó]rdenes)\s*$/iu.test(clause.slice(0, s).trim()) || /(?:compras?|pedidos?)\s+$/iu.test(clause.slice(0, s))
    const greetingOnly = before.every((w) => THRESHOLD_GREETING.has(w))
    if (!(orderShape || (greetingOnly && between.every((w) => w === 'el')))) return false
  }
  const cheapest = Math.min(...(rule.unitPrices ?? []).filter((p) => p > 0))
  let any = false
  for (const m of clause.matchAll(THRESHOLD_RE)) {
    if (m[1]) {
      if (Math.abs(Number(m[1].replace(/\D/g, '')) - over) > 1) return false
    } else {
      const n = COUNT_WORDS[m[2].toLowerCase()] ?? Number(m[2])
      if (!Number.isFinite(cheapest) || !(n >= 1) || n * cheapest < over - 1) return false
    }
    any = true
  }
  if (!any) return false
  // Verifier r2 #1 (INT-84 kept): no other amount at all in a threshold clause — only the captured threshold itself
  // ("Envío gratis desde ₡25 000, los 3 te quedan en ₡25 000" is refused).
  let rest = clause
  for (const [s, e] of thresholdCaptures(clause)) rest = rest.slice(0, s) + ' '.repeat(e - s) + rest.slice(e)
  if (!extractMoneyAmounts(rest).every((a) => Math.round(a) < 100) || [...rest.matchAll(BARE_AMOUNT_RE)].length > 0) return false
  // Verifier r4 #1 (INT-84): an ALLOWLIST — once the free-shipping words and the rule phrase are removed, only filler
  // may remain ("Tenemos … a todo el país", "Pedidos desde ₡X con envío gratis"). Never a product, a quantity or a verb
  // ("Tres cajas desde…", "La Menta desde…", "Lo tenés desde…").
  let words = clause
  for (const m of [...clause.matchAll(THRESHOLD_RE)].reverse()) words = words.slice(0, m.index ?? 0) + ' ' + words.slice((m.index ?? 0) + m[0].length)
  for (const w of freeShippingWording(words).reverse()) words = words.slice(0, w.index) + ' ' + words.slice(w.end)
  const left = words
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
  return left.every((w) => THRESHOLD_FILLER.has(w))
}
const THRESHOLD_ELIGIBILITY_RE =
  /(?<![\p{L}])(?:calific\p{L}*|aplic\p{L}*|tuy[oa]s?|lleg[aá]s|llegaste|lleg[oó]|alcanz\p{L}*|pas[aá]s|pasaste|super[aá]s|superaste|al\s+monto|no\s+pag[aá]s|sin\s+costo|va\s+gratis|van\s+gratis|sale\s+gratis|a\s+vos|a\s+ti|te\s+(?:aplica|sale|queda|toca)|tu\s+(?:pedido|compra|env[ií]o|orden|carrito|total)|con\s+lo\s+que\s+llev[aá]s)(?![\p{L}])/iu
/** Words that say an order is enough for free shipping, outside the rule clause (SecureDog r4 INT-166). */
const THRESHOLD_ENOUGH_RE = /(?<![\p{L}])(?:gratis|sin\s+env[ií]o|sin\s+costo|cubiert[oa]s?|bast(?:a|an|ar[ií]a)|suficientes?|entra(?:n|r[ií]a)?)(?![\p{L}])/iu
/** "2 cajas", "dos tubos", "3 Menta": a count of products (checked against the threshold). */
const UNIT_MENTION_RE = /(?<![\p{L}\d.,₡])(\d{1,2}|dos|tres|cuatro|cinco|seis)\s+(?:cajas?|unidades|productos?|paquetes?|bolsas?|frascos?|tubos?|piezas?|\p{Lu}\p{L}+)(?![\p{L}])/gu
/** Second person / "ya" / "con esto" — a sentence about THIS customer next to the threshold rule (INT-166). */
const THRESHOLD_PERSONAL_RE =
  /(?<![\p{L}])(?:vos|tu|tus|te|ti|tuy\p{L}*|ya|usted|con\s+(?:esto|eso|est[oa]s|es[oa]s)|\p{L}+[áéí]s|\p{L}+(?:aste|iste))(?![\p{L}])/iu
/** Common words that end like a second-person verb but are not one. */
const THRESHOLD_PERSONAL_OK_RE = /(?<![\p{L}])(?:m[aá]s|adem[aá]s|despu[eé]s|pa[ií]s|jam[aá]s|atr[aá]s|tambi[eé]n|cort[eé]s|ingl[eé]s|demás)(?![\p{L}])/giu
const THRESHOLD_GREETING = new Set('hola buenas claro si gracias ok dale perfecto genial'.split(' '))
const THRESHOLD_FILLER = new Set(
  'tenemos hay el la es va en con y de del para a todo pais compras compra pedidos pedido ordenes hola claro si gracias ademas ofrecemos manejamos nuestro nuestros envio envios gratis domicilio'.split(' '),
)

const foldNote = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * A bracketed note that is word-for-word part of an owner's bundle / catalog name ("Pack 2 bolsas (60 noches)") is
 * not a clause break: blank it out (same length, so match positions stay valid). Any other bracket stays visible and
 * keeps breaking the clause — nothing can hide inside one (SecureDog INT-126).
 */
function maskNameParentheticals(text: string, nameNotes: ReadonlyArray<string>): string {
  if (!nameNotes.length) return text
  const notes = new Set(nameNotes.map(foldNote).filter(Boolean))
  return text.replace(/\(([^()\n]*)\)/g, (m, inner: string) => (notes.has(foldNote(inner)) ? ' '.repeat(m.length) : m))
}

/** Words that stretch one combo's fact to more items, anywhere in the reply (INT-91). */
const FREE_SHIPPING_SPREAD_RE = /(?<![\p{L}])(tambi[eé]n|igual(?:mente)?|lo\s+mismo|ambos|ambas|los\s+dos|las\s+dos|todos|todas|van|incluyen|traen|vienen)(?![\p{L}])/iu
/** Bare amounts too ("17.900", "17900"), not only ₡ ones. */
const BARE_AMOUNT_RE = /\d{1,3}(?:[.,   ]\d{3})+|\d{4,7}/g

/** Clause spans: sentence ends, parentheses, line breaks (a period inside ₡25.000 is not an end). */
/**
 * Sleeping C8: "con el pack de 2 bolsas (₡19 800) el envío va incluido" — brackets holding ONLY an included combo's
 * price are not a clause break (the brackets become spaces, same length). Any other bracket keeps breaking (INT-126).
 */
function maskIncludedPriceParentheticals(text: string, includedPrices: ReadonlyArray<number>): string {
  if (!includedPrices.length) return text
  return text.replace(/\(\s*[₡¢]\s?(\d{1,3}(?:[.,\s ]\d{3})+|\d{4,7})\s*\)/gu, (m, amount: string) => {
    const v = Number(amount.replace(/\D/g, ''))
    return includedPrices.some((p) => Math.abs(p - v) <= 1) ? ` ${m.slice(1, -1)} ` : m
  })
}

/** The clause before ", y" states a shipping cost ("Con 1 bolsa el envío cuesta ₡3 000", "son ₡3 000 de envío"). */
// SecureDog r2 (INT-186 hardening): never "₡0" — a zero shipping cost is a free-shipping claim, not a cost statement.
const SHIPPING_COST_TAIL_RE = /env[ií]o\s+(?:cuesta|sale|es|vale|queda)\s+(?:en\s+)?[₡¢]\s?[1-9][\d.,\s\u00a0]*$|[₡¢]\s?[1-9][\d.,\s\u00a0]*\s+de\s+env[ií]o\s*$/iu

function clauseSpans(text: string, splitAtCommaY = true): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let start = 0
  // Sleeping C8: ", y …" starts a new clause too ("Con 1 bolsa el envío cuesta ₡3 000, y el pack de 2 … con envío
  // incluido" — the ₡3 000 belongs to the first clause, not to the combo fact).
  for (const m of text.matchAll(/(?:(?<!\d)\.|\.(?!\d)|[!?;()\n]|,(?=\s+y\s))+/g)) {
    // SecureDog r1 INT-184: ", y" ends a clause ONLY right after a shipping-cost statement ("el envío cuesta ₡3 000").
    if (m[0] === ',' && (!splitAtCommaY || !SHIPPING_COST_TAIL_RE.test(text.slice(start, m.index ?? 0)))) continue
    spans.push([start, m.index ?? 0])
    start = (m.index ?? 0) + m[0].length
  }
  spans.push([start, text.length])
  return spans
}

/**
 * "Envío incluido / gratis" without a promo is only true for a combo the owner marked as including shipping: every
 * such phrase must sit in ONE clause (never split across a break) that says "combo", quotes only included-combo
 * prices (at least one), and has no wording that makes it personal or an exception (SecureDog INT-84/85).
 */
export function freeShippingRuleOk(rawText: string, rule: FreeShippingRule): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  const text = maskIncludedPriceParentheticals(maskNameParentheticals(rawText, rule.nameNotes ?? []), rule.includedPrices)
  const extraWords = (rule.bundleWords ?? []).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
  const bundleWordRe = new RegExp(`(?<![\\p{L}])(?:combos?|packs?|kits?${extraWords.length ? '|' + extraWords.map((w) => `${w}s?`).join('|') : ''})(?![\\p{L}])`, 'giu')
  const matches = freeShippingWording(text)
  if (matches.length === 0 || (rule.includedPrices.length === 0 && !rule.freeOver)) return false
  const spans = clauseSpans(text)
  const sentenceSpans = clauseSpans(text, false)
  const spanOf = (m: { index: number; end: number }) => spans.find(([s, e]) => m.index >= s && m.index < e)
  // P2: clauses that state the store's own threshold rule are judged on their own (a rule for every order may say
  // "todos"); the spread check below reads the rest of the reply.
  const thresholdSpans = rule.freeOver
    ? matches.map(spanOf).filter((sp): sp is [number, number] => Boolean(sp) && thresholdClauseOk(text.slice(sp![0], sp![1]), rule))
    : []
  // SecureDog r2 INT-166: with the threshold rule said, nothing in the reply may say THIS order reaches it ("tu pedido
  // califica", "el tuyo va gratis", "ya llegaste al monto", "no pagás envío") — that is a multi-unit total (INT-94).
  if (thresholdSpans.length > 0 && THRESHOLD_ELIGIBILITY_RE.test(text)) return false
  // SecureDog r3 INT-166: outside the rule clause itself, nothing addressed to this customer ("Ya entraste", "Vos ya
  // estás", "Con 2 lo cumplís", "Ese monto ya lo cubrís") — second person, "ya", "con esto / con dos".
  if (thresholdSpans.length > 0) {
    let others = text
    for (const [s, e] of thresholdSpans) others = others.slice(0, s) + ' '.repeat(e - s) + others.slice(e)
    // Verifier r6 #3: questions may address the customer ("¿Cuántas cajas te gustaría?"); eligibility words were
    // checked on the whole reply above.
    const statements = others.replace(/¿[^?¿]*\?/gu, ' ').replace(/(?:^|[.!\n])[^.!?\n]*\?/gu, ' ')
    if (THRESHOLD_PERSONAL_RE.test(statements.replace(THRESHOLD_PERSONAL_OK_RE, ' '))) return false
    // SecureDog r4 INT-166: "Con dos cajas queda gratis", "Dos cajas bastan", "Este pedido entra", "sale sin envío".
    if (THRESHOLD_ENOUGH_RE.test(others)) return false
    const cheapest = Math.min(...(rule.unitPrices ?? []).filter((p) => p > 0))
    for (const m of others.matchAll(UNIT_MENTION_RE)) {
      const n = COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1])
      if (n >= 2 && (!Number.isFinite(cheapest) || n * cheapest < (rule.freeOver ?? 0) - 1)) return false
    }
  }
  let rest = text
  for (const [s, e] of thresholdSpans) rest = rest.slice(0, s) + ' '.repeat(e - s) + rest.slice(e)
  // One included combo per fact: nothing in the reply may stretch it to other items.
  if (FREE_SHIPPING_SPREAD_RE.test(rest)) return false
  const others = (rule.otherNames ?? []).map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3)
  for (const m of matches) {
    const span = spanOf(m)
    if (!span || m.end > span[1]) return false
    if (thresholdSpans.some(([s, e]) => s === span[0] && e === span[1])) continue
    if (rule.includedPrices.length === 0) return false
    const clause = text.slice(span[0], span[1])
    // Exactly one combo / pack named in the clause (not "el Combo Trío y el Combo 2").
    if ((clause.match(bundleWordRe) || []).length !== 1) return false
    // SecureDog r1 INT-184: exception / personal words and other products are judged on the WHOLE sentence (never
    // escaping behind ", y"); only the amounts are judged on the clause.
    const sentenceSpan = sentenceSpans.find(([s0, e0]) => span[0] >= s0 && span[0] < e0) ?? span
    const sentence = text.slice(sentenceSpan[0], sentenceSpan[1])
    if (FREE_SHIPPING_EXCEPTION_RE.test(sentence)) return false
    const lower = sentence.toLowerCase()
    if (others.some((n) => new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(lower))) return false
    const amounts = [
      ...extractMoneyAmounts(clause).map((a) => Math.round(a)),
      ...[...clause.matchAll(BARE_AMOUNT_RE)].map((x) => Number(x[0].replace(/\D/g, ''))),
    ].filter((a) => a >= 100)
    if (amounts.length === 0) return false
    if (!amounts.every((a) => rule.includedPrices.some((p) => near(a, p)))) return false
  }
  return true
}


/**
 * Pura Sonrisa P2 with INT-84 kept: the threshold amount is NOT an allowed price. It passes only when every place it is
 * written sits in a clause that states the store's threshold rule ("envío gratis desde ₡19 900") — never as a price
 * ("los 3 en ₡19 900").
 */
export function thresholdAmountOk(amount: number, rawText: string, rule: FreeShippingRule | null | undefined): boolean {
  if (!rule?.freeOver || Math.abs(Math.round(amount) - rule.freeOver) > 1) return false
  const text = maskNameParentheticals(rawText, rule.nameNotes ?? [])
  const spans = clauseSpans(text)
  const captures = thresholdCaptures(text)
  let seen = false
  for (const m of text.matchAll(COLON_AMOUNT_RE)) {
    if (Math.abs(Number(m[1].replace(/\D/g, '')) - rule.freeOver) > 1) continue
    seen = true
    const at = m.index ?? 0
    // Verifier r2 #1: each written threshold amount must BE a captured one ("desde ₡25 000"), never a second copy.
    if (!captures.some(([s]) => s === at)) return false
    const span = spans.find(([s, e]) => at >= s && at < e)
    if (!span) return false
    const clause = text.slice(span[0], span[1])
    if (freeShippingWording(clause).length === 0 || !thresholdClauseOk(clause, rule)) return false
  }
  // The amount in any other money form ("25 000 colones", "25 mil") is never the threshold rule.
  const otherForms = extractMoneyAmounts(text.replace(COLON_AMOUNT_RE, ' ')).some((a) => Math.abs(Math.round(a) - rule.freeOver!) <= 1)
  return seen && !otherForms
}
/** Deal check with the narrower included-combo rule on top of the promo kinds. */
/**
 * Lane C D6: a bundle stored with its shipping included ("Pedido de 2 arneses", ₡32 800, shippingIncluded) may be quoted
 * as "₡32 800 con envío incluido": in a sentence that quotes one of those amounts, only the "envío incluido / incluye el
 * envío" wording is excused ("gratis" and every other deal word are still judged).
 */
const INCLUDED_SHIPPING_WORDING_RE = /(?:con\s+(?:el\s+)?)?env[ií]os?\s+incluid[oa]s?|incluye(?:n)?\s+(?:el\s+)?env[ií]o/giu
export function maskIncludedShipping(text: string, includedAmounts: readonly number[] | null | undefined): string {
  if (!includedAmounts || includedAmounts.length === 0) return text
  const set = new Set(includedAmounts.map((n) => Math.round(n)))
  return text
    .split(/(?<=[.!?\n])/u)
    .map((seg) => {
      // SecureDog r2 F3 / Verifier r2 #7: only a sentence whose every amount is an included one, with one such phrase
      // ("₡18 000 con envío incluido y el pack ₡32 800", "… y todos los demás incluyen el envío" are still judged).
      const amounts = extractMoneyAmounts(seg)
      const phrases = seg.match(INCLUDED_SHIPPING_WORDING_RE)?.length ?? 0
      // SecureDog r3: never with a scope word ("Hoy envío incluido en todo, el pack …"): that is a store-wide offer.
      const storeWide = /(?<![\p{L}])(?:todo|todos|todas|toda|cualquier|cualquiera|dem[aá]s|tambi[eé]n|igual)(?![\p{L}])/iu.test(seg)
      return amounts.length > 0 && amounts.every((a) => set.has(Math.round(a))) && phrases === 1 && !storeWide ? seg.replace(INCLUDED_SHIPPING_WORDING_RE, ' ') : seg
    })
    .join('')
}

function dealProblemWithRule(text: string, allowed: ReadonlyArray<'free_shipping' | 'special_price'>, rule: FreeShippingRule | null | undefined): boolean {
  if (!dealProblem(text, allowed)) return false
  if (!rule || allowed.includes('free_shipping')) return true
  // Only free-shipping wording is the problem, and every phrase is an included-combo fact.
  return dealProblem(text, [...allowed, 'free_shipping']) || !freeShippingRuleOk(text, rule)
}

// Everywhere: "ya creé / registré", and (N3) "tu pedido / tu orden / tu compra" + a confirmation verb. Not "sale
// mañana" (a delivery time) nor "tu pedido está listo para retirar".
const CREATED_CLAIM_RE =
  /ya\s+(cre[eé]|registr[eé]|arm[eé])|pedido\s+creado|acabo\s+de\s+crear|(?:tu|su)\s+(?:pedido|orden|compra)\s+(?:ya\s+)?(?:qued[oó]\s+|est[aá]\s+|fue\s+)?(?:registrad|anotad|confirmad|agendad)[oa]/iu
/**
 * SecureDog INT-117 (+ residual): ONLY on the contra-entrega / efectivo closing turn the agent must not make up the
 * order's confirmation or schedule — a person confirms after the order_ready hand-off.
 */
const ORDER_CLOSING_CLAIM_RE =
  /pedido\s+(?:ya\s+)?(?:qued[oó]\s+|est[aá]\s+)?(?:registrad|anotad|agendad|confirmad|list)[oa]|(?:orden|compra)\s+(?:ya\s+)?(?:qued[oó]\s+|est[aá]\s+)?(?:registrad|anotad|agendad|confirmad|list)[oa]|(?<![\p{L}])agend[eé](?![\p{L}])|anot[eé]\s+(?:tu|el|su)\s+pedido|sale\s+(?:hoy|ma[nñ]ana)|te\s+(?:lo|la|los|las)\s+mando\s+(?:hoy|ma[nñ]ana)|ma[nñ]ana\s+te\s+llega|(?:queda|qued[oó])\s+(?:programad|agendad)\p{L}*|te\s+(?:lo|la|los|las)\s+despachamos|va\s+en\s+camino|tu\s+entrega\s+(?:queda|est[aá])\s+(?:para|agendada)/iu
const UNIT_COST_RE = /unitCost|costo\s+unitario|precio\s+de\s+costo/i
/**
 * SecureDog r2 F2: a reply that asks for card data by chat (number, CVV / security code, expiry). Never repairable: a
 * card is paid only through the store's card link.
 */
const CARD_DATA_NOUN_RE =
  /(?<![\p{L}])(?:n[uú]meros?|d[ií]gitos|datos|foto|fotos|imagen)\s+de\s+(?:la\s+|tu\s+|su\s+)?tarjeta|(?<![\p{L}])tarjeta(?![\p{L}])[^.!?\n]{0,60}(?<![\p{L}])(?:vencimiento|expiraci[oó]n|caducidad|d[ií]gitos|atr[aá]s)(?![\p{L}])|(?<![\p{L}])(?:cvv|cvc|cvv2)(?![\p{L}])|c[oó]digo\s+(?:de\s+seguridad|de\s+atr[aá]s)|(?:3|tres)\s+(?:d[ií]gitos|n[uú]meros)\s+de\s+atr[aá]s|(?<!\d)(?:16|diecis[eé]is)\s+(?:d[ií]gitos|n[uú]meros)/iu
/** A warning, not an ask: "nunca / no mandés … por chat", "no hace falta". */
const CARD_DATA_NEGATED_RE = /(?<![\p{L}])(?:nunca|jam[aá]s|no\s+(?:me\s+|nos\s+)?(?:mand|envi|pas|compart|escrib|d[eé]|hace\s+falta|ocup|necesit|ped))/iu
/**
 * SecureDog r2 F2 / r3: a reply that asks for card data by chat (number, digits, photo, CVV / security code, expiry),
 * whatever the verb or form ("¿Me podés pasar el número de tu tarjeta?", "Envíeme el número de su tarjeta"). Only a
 * sentence that warns against it is excused. Never repairable: a card is paid only through the store's card link.
 */
function asksCardData(text: string): boolean {
  return (text || '')
    .split(/(?<=[.!?\n])/u)
    .some((sentence) => CARD_DATA_NOUN_RE.test(sentence) && !CARD_DATA_NEGATED_RE.test(sentence))
}

/** Sleeping C7: "ya te lo compartí / dije / pasé / mencioné / indiqué" (refusing to repeat what the customer asks again). */
const REPEAT_REFUSAL_RE =
  /(?<![\p{L}])(?:ya\s+(?:te|se|le|les)\s+(?:(?:lo|la|los|las)\s+)?(?:hab[ií]a\s+)?(?:compart\p{L}*|dicho|dije|di|pas[eé]|pasado|mencion\p{L}*|indiqu[eé]|indicado|envi[eé]|enviado|mand[eé]|mandado)|como\s+(?:ya\s+)?(?:te|le)\s+(?:dije|coment[eé]|mencion[eé]|indiqu[eé]|hab[ií]a\s+dicho))(?![\p{L}])/iu

/** One line of a personal-data block: a phone, an email, a "Provincia, Cantón, Distrito" place, an address or a name. */
const DATA_LABEL_RE = /^(?:[-•*]\s*)?(?:nombre(?:\s+completo)?|tel[eé]fono|celular|cel|whatsapp|correo|e-?mail|provincia|cant[oó]n|distrito|direcci[oó]n(?:\s+exacta)?|se[nñ]as|c[eé]dula)\s*[:\-–]\s*/iu
const DATA_PHONE_LINE_RE = /^[+()\d\s.-]*(?<!\d)\d{4}[\s.-]?\d{4}(?!\d)[\s\d.-]*$/u
const DATA_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u
const DATA_PLACE_RE = /^\p{Lu}[\p{L}.\s]{1,40}(?:,\s*\p{Lu}[\p{L}.\s]{1,40}){1,3}\.?$/u
const DATA_ADDRESS_RE = /(?<![\p{L}])(?:\d+\s*(?:m|mts|metros|km)\s+(?:al\s+)?(?:norte|sur|este|oeste)|de\s+la\s+(?:iglesia|escuela|plaza|pulper[ií]a|parada)|casa\s+(?:color|blanca|verde|azul|amarilla|n[uú]mero|#)|frente\s+a|contiguo\s+a|costado\s+(?:norte|sur|este|oeste)|apartamento|condominio|residencial|barrio)(?![\p{L}])/iu
const DATA_NAME_RE = /^\p{Lu}\p{Ll}+(?:\s+(?:de\s+|del\s+|la\s+)?\p{Lu}\p{Ll}+){1,4}$/u

/** Words a data value never is ("Te dejo nuestro WhatsApp", "¡Gracias!"): such a line is a sentence, not data. */
const DATA_NOT_VALUE_RE =
  /(?<![\p{L}])(?:te|le|les|nos|nuestro|nuestra|nuestros|escrib\p{L}*|llam\p{L}*|whatsapp|gracias|hola|aqu[ií]|ac[aá]|este|esta|es|son|est[aá]|tu|su|para|por|con|que|qu[eé]|cuando|si|pod[eé]s|puedes|quer[eé]s|pedido|precio|total|producto|bolsa|pack|env[ií]o|pago|horario|lunes|abierto)(?![\p{L}])/iu
/** A location bubble / maps link the customer shared ("[ubicación]", "📍 https://maps.app.goo.gl/…"). */
const DATA_LOCATION_RE = /^(?:\[(?:ubicaci[oó]n|location)[^\]]*\]|(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|waze\.com)\S*)$/iu
/** One short value: up to 5 words of letters only ("Cartago", "Llanos de Santa Lucía", "maría pérez"). */
const DATA_WORDS_RE = /^[\p{L}][\p{L}'.,\s-]{0,60}$/u

/**
 * Sleeping exam C9 (night silent trial, 2026-10-03): after a location pin the model replied with nothing but a name /
 * phone / address block copied from the chat. A reply of 2+ lines where EVERY line is personal data and at least one
 * is a phone or an email is never sent (it is never an answer; it can leak one person's data). Verifier r1: a data
 * line is also a labelled one ("Provincia: Cartago"), a lone place / name word (any case), a location placeholder or a
 * maps link. A phone the store itself publishes (`ownText`: its brand facts) is not an echo. An order summary
 * ("Producto: …", "Total …") or the data-request list ("- Nombre completo") has other lines and passes. Pure.
 */
export function isPersonalDataEcho(text: string, ownText?: string | null): boolean {
  const lines = (text || '')
    .split('\n')
    .map((l) => l.replace(/[\p{Extended_Pictographic}️]/gu, ' ').trim())
    .filter(Boolean)
  if (lines.length < 2 || lines.length > 12) return false
  const own = new Set(
    [...(ownText || '').matchAll(/\d[\d\s.-]{6,}\d/g)].map((m) => m[0].replace(/\D/g, '')).filter((d) => d.length >= 8).map((d) => d.slice(-8)),
  )
  const isOwnPhone = (v: string) => own.size > 0 && own.has(v.replace(/\D/g, '').slice(-8))
  const raw = lines.map((l) => l.replace(/^[-•*–]\s*/u, ''))
  const labelled = raw.map((l) => DATA_LABEL_RE.test(l))
  const values = raw.map((l) => l.replace(DATA_LABEL_RE, '').trim())
  const contact = values.some((v) => (DATA_PHONE_LINE_RE.test(v) && !isOwnPhone(v)) || DATA_EMAIL_RE.test(v))
  if (!contact) return false
  return values.every((v, i) => {
    if (DATA_PHONE_LINE_RE.test(v)) return !isOwnPhone(v)
    if (labelled[i]) return true
    if (!v) return false
    if (DATA_EMAIL_RE.test(v) || DATA_LOCATION_RE.test(v) || DATA_PLACE_RE.test(v) || DATA_ADDRESS_RE.test(v) || DATA_NAME_RE.test(v)) return true
    return DATA_WORDS_RE.test(v) && v.split(/[\s,]+/).filter(Boolean).length <= 6 && !DATA_NOT_VALUE_RE.test(v)
  })
}
const SHIP_CUE_RE = /env[ií]o|retiro|domicilio|\bGAM\b|correos|mensajer/i
const PAY_CUE_RE = /\b(pago|sinpe|transferencia|tarjeta|efectivo|contra\s*entrega)\b/i
const PURCHASE_INTENTS = new Set<AgentIntent>(['price', 'how_to_buy'])

export function extractMoneyAmounts(text: string): number[] {
  // NFKC: the full-width "￠" becomes "¢" (INT-104: "¢" is a colón sign too).
  // "N mil" / "Nmil" is N × 1000 next to a currency sign or colones ("₡15 mil", "15 mil colones"); sign-less unless a
  // count noun follows (bareMilAmounts, round 4). "₡9.900 mil gracias" is ₡9.900 (R4).
  const t = (text || '').normalize('NFKC')
  const amounts: number[] = []
  for (const match of t.matchAll(MONEY_AMOUNT_RE)) {
    const spaced = match[1] || match[3] || ''
    const raw = spaced.replace(/\s/g, '')
    const thousand = Boolean(match[2] || match[4]) && !hasThousandsSeparator(spaced)
    const normalized = raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')
    const value = Number(normalized) * (thousand ? 1000 : 1)
    if (Number.isFinite(value) && value > 0) amounts.push(value)
  }
  return [...amounts, ...bareMilAmounts(t)]
}

/** "9.900", "12,900", "12 900": already a full amount — a following "mil" is not a multiplier (R4). */
export function hasThousandsSeparator(digits: string): boolean {
  return /\d[.,\s]\d{3}(?!\d)/.test(digits)
}

/**
 * Count / unit nouns: "N mil" right before one of these (optionally after "de") is a count, not money (round 4,
 * INT-104 reopened — a blocklist, so any other wording of a price stays checked).
 */
export const MIL_COUNT_WORDS = [
  'pasos', 'mah', 'ml', 'mg', 'g', 'gr', 'kg', 'km', 'metros', 'm', 'cm', 'unidades', 'personas', 'clientes', 'seguidores',
  'reseñas', 'comentarios', 'vendidos', 'vendidas', 'ventas', 'pedidos', 'familias', 'parches', 'productos', 'años',
  'horas', 'minutos', 'likes', 'visitas', 'compras', 'usuarios', 'envíos', 'envios', 'veces', 'opiniones', 'fans',
]

/**
 * Sign-less "N mil" amounts (round 4): money UNLESS a count / unit noun follows ("5 mil parches", "2 mil reseñas",
 * "10 mil pasos", "5 mil mAh", "más de 5 mil pedidos"). "Por 15 mil te lo llevás", "Está en 15 mil", "Son 15 mil
 * pesos", "Cuesta 15 mil exactos", "Son 5 mil parches por 4 mil" (→ 4 000) are money. One helper for the live
 * validator and the save-time check (agent-tuning-core colonAmountsIn). `extraCountWords`: e.g. the agent's product
 * name tokens, when the caller has them.
 */
export function bareMilAmounts(text: string, extraCountWords: readonly string[] = []): number[] {
  const t = (text || '').normalize('NFKC')
  const counts = new Set([...MIL_COUNT_WORDS, ...extraCountWords.map((w) => w.toLowerCase())])
  const out: number[] = []
  for (const m of t.matchAll(/(?<![\d.,₡¢$\p{L}])(\d{1,3})\s*mil(?![\p{L}])/giu)) {
    const after = t.slice((m.index ?? 0) + m[0].length)
    if (/^\s*(?:colones|crc|usd)(?![\p{L}])/iu.test(after)) continue // counted with its currency word
    const next = after.match(/^\s+(?:de\s+)?(\p{L}+)/iu)?.[1]?.toLowerCase()
    if (next && counts.has(next)) continue
    out.push(Number(m[1]) * 1000)
  }
  return out
}

/**
 * INT-112: what a model reply may link — brand website / catalog, the maps URL when it is a map link, and links the
 * owner wrote in active saved replies and approved bound knowledge (links.ts buildLinkAllowlist).
 */
export function brandFactsLinkAllowlist(
  facts: Pick<BrandFacts, 'website' | 'catalogUrl' | 'location'> | null | undefined,
  ownerTexts: Array<string | null | undefined> = [],
): LinkAllowlist {
  // The card link ([[PAGO_TARJETA]]) is NOT added here: links are checked before code fills it (applyFinalOutputPolicy).
  return buildLinkAllowlist({ website: facts?.website, catalogUrl: facts?.catalogUrl, mapsUrl: facts?.location?.mapsUrl, ownerTexts })
}

// SecureDog r2 INT-168 (pre-existing): "15 000 colones" (space / no-break-space thousands) is money too.
const MONEY_AMOUNT_RE =
  /[₡¢$]\s?(\d(?:[\d.\s]*\d)?)(\s*mil(?![\p{L}]))?|(?<![\d.,\p{L}])(\d{1,3}(?:[   ]\d{3})+|\d[\d.,]*)(\s*mil)?\s*(?:colones|crc|usd)(?![\p{L}])/giu

function amountAllowed(amount: number, allowed: number[]): boolean {
  const rounded = Math.round(amount)
  return allowed.some((candidate) => Math.abs(Math.round(candidate) - rounded) <= 1)
}

/**
 * Sleeping exam C3 (2026-10-18): a per-night / per-patch amount ("₡317 por noche") is sourced only as a STORE rate:
 * the price of a product / combo whose own name carries the count ("Pack 3 bolsas (90 noches)" ₡28 500 → ₡317 por
 * noche; sales-state salesUnitRates). SecureDog r1 INT-162: never a count the customer or the model wrote, never a
 * shipping amount. Every place the amount is written must be directly followed by "por / cada / x / / / al / a la" + the
 * SAME unit (noche ↔ noches); written in any other money form ("317 colones", "317 mil") it is refused.
 */
/** name: the owner's product / combo name the rate comes from ("Pack 3 bolsas (90 noches)"). */
export type UnitRate = { price: number; count: number; unit: string; name?: string }
const UNIT_WORD = String.raw`(noches?|d[ií]as?|parches?|usos?|aplicaci[oó]n(?:es)?|dosis)`
const PER_UNIT_AFTER_RE = new RegExp(String.raw`^\s*(?:colones\s*)?(?:por|cada|x|\/|al|a\s+la|la|el)\s*${UNIT_WORD}(?![\p{L}])`, 'iu')
const COLON_AMOUNT_RE = /[₡¢]\s?(\d{1,3}(?:[.,\s ]\d{3})+|\d+)(?![\d])/gu

export function unitFamily(word: string): string {
  const w = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return w.startsWith('noche') ? 'noche' : w.startsWith('dia') ? 'dia' : w.startsWith('parche') ? 'parche' : w.startsWith('uso') ? 'uso' : w.startsWith('aplicacion') ? 'aplicacion' : 'dosis'
}

const NUMBER_WORDS: Record<string, number> = { una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, doble: 2, triple: 3 }
const SMALL_NUMBER_RE = /(?<![\d.,₡¢])(\d{1,4})(?![\d.,])|(?<![\p{L}])(una|un|uno|dos|tres|cuatro|cinco|seis|doble|triple)(?![\p{L}])/giu
function nameNumbers(name: string): number[] {
  return [...name.matchAll(SMALL_NUMBER_RE)].map((m) => (m[1] ? Number(m[1]) : NUMBER_WORDS[m[2].toLowerCase()]))
}
/** Plain numbers (not money) in the sentence around position `at` of the amount. */
function sentenceNumbers(raw: string, at: number, len: number): number[] {
  // A period between digits (₡28.500) is not a sentence end.
  const text = raw.replace(/(?<=\d)\.(?=\d)/g, ',')
  const start = Math.max(...['.', '!', '?', '\n'].map((c) => text.lastIndexOf(c, at - 1) + 1), 0)
  const ends = ['.', '!', '?', '\n'].map((c) => text.indexOf(c, at + len)).filter((i) => i >= 0)
  const sentence = text.slice(start, ends.length ? Math.min(...ends) : text.length).replace(COLON_AMOUNT_RE, ' ')
  return [...sentence.matchAll(SMALL_NUMBER_RE)].map((m) => (m[1] ? Number(m[1]) : NUMBER_WORDS[m[2].toLowerCase()])).filter((n) => n > 1)
}

export function unitDerivedAmount(amount: number, text: string, rates: ReadonlyArray<UnitRate> | null | undefined): boolean {
  const rounded = Math.round(amount)
  const valid = (rates ?? []).filter((r) => r.price > 0 && r.count >= 2)
  if (!valid.length) return false
  let seen = false
  for (const m of text.matchAll(COLON_AMOUNT_RE)) {
    if (Number(m[1].replace(/\D/g, '')) !== rounded) continue
    seen = true
    const at = m.index ?? 0
    const after = PER_UNIT_AFTER_RE.exec(text.slice(at + m[0].length, at + m[0].length + 30))
    if (!after) return false
    const family = unitFamily(after[1])
    // Verifier r3 #4: the numbers the sentence names ("el pack de 2", "3 bolsas", "90 noches") must belong to the rate's
    // own product — "El pack de 2 sale a ₡317 por noche" (the pack-of-3 rate) is refused.
    const named = sentenceNumbers(text, at, m[0].length)
    const fitsProduct = (r: UnitRate) => named.every((n) => n === r.count || nameNumbers(r.name || '').includes(n))
    if (!valid.some((r) => unitFamily(r.unit) === family && Math.abs(Math.round(r.price / r.count) - rounded) <= 1 && fitsProduct(r))) return false
  }
  if (!seen) return false
  // The same amount written without ₡ ("317 colones", "317 mil") is not a per-unit mention.
  return !extractMoneyAmounts(text.replace(COLON_AMOUNT_RE, ' ')).some((a) => Math.round(a) === rounded)
}

/**
 * Results / health promises (2026-10-17, live PatchHouse: "Muchas personas notan cambios en los primeros días").
 * Supplements may say what the site says ("apoya la relajación", "ayuda a reducir antojos"); they may never promise
 * an effect, a time to results, other people's results, a cure or weight loss. A promise right after a negation
 * ("no promete bajar de peso", "no cura") is the honest disclaimer and passes.
 */
/** Verifier F5: "la diferencia en el precio", "el resultado del pedido", "en la página" are about the order, not a body. */
const NOT_ABOUT_THE_BODY = String.raw`(?!\s+(?:en|del|de)\s+(?:(?:tu|la|el|su|los|las)\s+)?(?:precio|pedido|compra|p[aá]gina|web|env[ií]o|tienda|paquete|cuenta|pago))`
/** What an effect on the body sounds like (other people's experience only counts with one of these nearby). */
const BODY_EFFECT = String.raw`(?:cambio|resultado|mejor|diferencia|efecto|beneficio|energ|calma|concentra|alivio|[aá]nimo|antojo|sueño|peso|ansiedad|estr[eé]s|dorm|duerm|relaja|funciona)`
const RESULTS_CLAIM_RES: RegExp[] = [
  new RegExp(
    String.raw`\b(?:muchas|varias|algunas|la\s+mayor[ií]a\s+de\s+las?|miles\s+de)\s+(?:personas|clientes|clientas|usuarios|usuarias|gente)\s+(?:(?:nos\s+|me\s+)?(?:cuentan|dicen|comentan)\s+que\b|(?:ya\s+)?(?:notan|sienten|ven|reportan|han\s+notado|han\s+sentido|nota|siente)\b)(?![^.!?\n]{0,40}(?:precio|env[ií]o|pedido|paquete|entrega|atenci|servicio))[^.!?\n]{0,40}?${BODY_EFFECT}`,
    'iu',
  ),
  new RegExp(
    String.raw`\b(?:vas\s+a(?:\s+poder)?|vas\s+a\s+empezar\s+a|podr[áa]s|pod[ée]s|empez[áa]s\s+a)\s+(?:notar|sentir|ver)\s+(?:los\s+|las\s+|un\s+|una\s+|el\s+|la\s+)?(?:cambios?|resultados?|mejor[ií]as?|diferencias?|efectos?|beneficios?)\b${NOT_ABOUT_THE_BODY}`,
    'iu',
  ),
  new RegExp(String.raw`\b(?:notar[áa]s|sentir[áa]s|ver[áa]s)\s+(?:los\s+|las\s+|un\s+|una\s+|el\s+|la\s+)?(?:cambios?|resultados?|mejor[ií]as?|diferencias?|efectos?)\b${NOT_ABOUT_THE_BODY}`, 'iu'),
  /\b(?:cambios?|resultados?|efectos?|mejor[ií]as?)\s+(?:visibles\s+)?(?:en|desde|a\s+partir\s+de|durante)\s+(?:los\s+|las\s+)?(?:primer(?:os|as)|pocos|pocas|\d+)\s+(?:d[ií]as?|semanas?|horas?)\b/iu,
  // "envío garantizado" / "pago seguro garantizado" are about the order: only a guaranteed effect counts.
  /\b(?:te\s+garantizo\s+(?:que|(?:los\s+|el\s+)?(?:resultados?|cambios?|efectos?))|garantiza(?:do|da|mos|n)?\s*:?\s+(?:que\s+(?:funciona|vas|te)|vas\s+a|(?:los\s+|el\s+)?(?:resultados?|efectos?|cambios?))|(?:resultados?|efectos?|cambios?|funciona)\s+garantizad[oa]s?)/iu,
  // "te va a quitar la ansiedad", "te quita el estrés".
  /\b(?:te\s+)?(?:va\s+a\s+)?quit(?:a|ar|an)\s+(?:la|el|tu|tus|los|las)\s+(?:ansiedad|estr[eé]s|antojos?|insomnio|dolor(?:es)?|hambre|cansancio|fatiga)\b/iu,
  // "vas a sentir más energía", "vas a tener más concentración".
  /\b(?:vas\s+a|va\s+a|te\s+vas\s+a|te\s+va\s+a\s+(?:dar|hacer))\s+(?:sentir|notar|dormir|rendir)\s+(?:m[aá]s\s+|mucha\s+|much[oa]\s+)?(?:energ|calma|concentra|enfoque|[aá]nimo|relaja|mejor\b(?!\s+(?:atendid|servid|precio|opci))|tranquil)/iu,
  /\b(?:vas\s+a|va\s+a|te\s+va\s+a\s+dar)\s+tener\s+(?:m[aá]s\s+|mucha\s+|much[oa]\s+)(?:energ|calma|concentra|enfoque|[aá]nimo)/iu,
  // Time to an effect: "en una semana ves resultados", "desde la primera noche / el primer día".
  new RegExp(String.raw`\b(?:en|desde|a\s+(?:la|los|las|el))\s+(?:(?:una|un|\d+|pocos|pocas|la\s+primera|el\s+primer|primera|primer)\s+)?(?:semanas?|d[ií]as?|noches?|mes(?:es)?|uso)\b[^.!?\n]{0,25}?\b(?:(?:ves|ver[aá]s|vas\s+a\s+(?:ver|notar|sentir)|not[aá]s|notar[aá]s|sent[ií]s|sentir[aá]s)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|m[aá]s\s+)?(?:resultados?|cambios?|la\s+diferencia|diferencias?|efectos?|mejor[ií]as?|energ[ií]a|calma|alivio|beneficios?)|duerm\w*\s+mejor|dorm[ií]\w*\s+mejor)`, 'iu'),
  /\b(?:energ[ií]a|duerm\w*|dorm\w*|calma|ansiedad|resultados?|cambios?|efecto|relaja\w*|mejor)\b[^.!?\n]{0,40}?\bdesde\s+(?:el\s+primer\s+d[ií]a|la\s+primera\s+(?:noche|semana|vez)|el\s+primer\s+uso)/iu,
  /\b(?:cura|curan|curar|sana|sanan)\s+(?:la|el|tu|tus|los|las|de)\b/iu,
  // SecureDog INT-138 safety assurances: healthAssuranceIn (sentence rule, below).
  /\b(?:baj(?:ar|[áa]s|ar[áa]s)|perder|perd[ée]s|perder[áa]s)\s+(?:de\s+)?(?:peso|kilos|libras)\b|\badelgaz(?:ar|[áa]s|ar[áa]s)\b/iu,
]
const RESULTS_NEGATION_RE = /\b(?:no|ni|sin|nunca|jam[áa]s)\b[^.!?\n]{0,30}$/iu
/** An instruction not to say something ("nunca prometas…", "no digas que…", "evitá asegurar…"). */
const DONT_SAY_RE =
  /(?<![\p{L}])(?:(?:nunca|no|jam[aá]s)\s+(?:le\s+|les\s+)?(?:promet\p{L}*|dig[aá]s|digan|diga|ofrezc\p{L}*|asegur\p{L}*|garantic\p{L}*|afirm\p{L}*|insinu\p{L}*)|evit[aá]\s+(?:prometer|decir|asegurar|garantizar))(?![\p{L}])/iu
/** The text of the current sentence up to `index`. */
function sentenceBefore(text: string, index: number): string {
  const head = text.slice(0, index)
  const sentence = head.slice(Math.max(head.lastIndexOf('.'), head.lastIndexOf('!'), head.lastIndexOf('?'), head.lastIndexOf('\n')) + 1)
  // "Nunca prometas resultados, pero en una semana vas a notar cambios": the part after "pero" stands alone.
  return sentence.split(/\s+pero\s+/iu).pop() || ''
}
/** Reassurances that contain "no / sin" but do not deny the claim that follows. */
const NOT_A_NEGATION_RE = /\b(?:sin\s+dudas?|sin\s+problemas?|no\s+te\s+preocup[eé]s|no\s+se\s+preocupen?|no\s+hay\s+problemas?|no\s+hay\s+dudas?)\b/giu

/**
 * SecureDog round 5 (INT-138): health safety is judged per sentence, not by a phrase list — a sensitive group
 * (embarazo, lactancia, bebé, niños, medicamentos, presión, diabetes…) together with an assurance ("seguro", "apto",
 * "sin problema", "podés / se puede usar", "sin efectos secundarios", "no es peligroso", "no afecta") is a promise.
 * A doctor referral or an indirect question ("si es seguro…, consultá con tu médico") is not; a negation counts only
 * right before the assurance ("no es seguro", "no se recomienda").
 */
const HEALTH_GROUP_RE =
  // Verifier round 8: no bare "corazón" (a Costa Rican endearment); SecureDog round 6: "del corazón", hipertensión,
  // anticoagulantes, gestación, adultos mayores.
  /(?<![\p{L}])(?:embaraz\p{L}*|lactan\p{L}*|amamant\p{L}*|de\s+mamar|gestaci[oó]n|gestante|encinta|beb[eé]s?|ni[nñ][oa]s?|hij[oa]s?\s+(?:de\s+)?\d+\s+a[nñ]os|menores|adultos?\s+mayores|todas\s+las\s+edades|arritmi\p{L}*|ancian\p{L}*|tercera\s+edad|(?:problemas?|enfermedad\p{L}*|condici[oó]n)\s+(?:del?\s+)?coraz[oó]n|del\s+coraz[oó]n|cardiopat\p{L}*|hipertens\p{L}*|anticoagul\p{L}*|presi[oó]n\s+alta|medicament\p{L}*|medicinas?|pastillas?|presi[oó]n|diab[eé]t\p{L}*|anticonceptiv\p{L}*|tiroides|marcapasos|card[ií]ac\p{L}*|epilep\p{L}*|c[aá]ncer|quimio\p{L}*|antidepresiv\p{L}*|ansiol[ií]tic\p{L}*|sertralina|fluoxetina|escitalopram|clonazepam|alprazolam|ozempic|semaglutid\p{L}*|metformina|insulina|levotiroxina|warfarina|parkinson|alzheimer|hipotiroid\p{L}*|hipertiroid\p{L}*|menor(?:es)?\s+de\s+edad|(?:tengo|tiene|tienen|cumpl\p{L}*|(?:hij|sobrin|niet|herman|prim|abuel|t[ií])[oa]s?\s+de|ni[nñ][oa]s?\s+de|mam[aá]\s+de|pap[aá]\s+de|personas?\s+de|se[nñ]or[a]?\s+de)\s+(?:[1-9]|1[0-7]|[6-9]\d)\s+a[nñ]os|dando\s+(?:pecho|de\s+mamar)|posparto|postparto|reci[eé]n\s+parid\p{L}*|tratamiento\s+m[eé]dico|me\s+operaron|cirug[ií]a|operaci[oó]n|(?:mis|tus|sus|los)\s+hij[oa]s?(?=[^.?!\n]{0,30}(?:usar|tomar|poner|aplicar))|(?:usar|tomar|poner)\p{L}*[^.?!\n]{0,30}(?:mis|tus|sus|los)\s+hij[oa]s?)(?![\p{L}])/iu
/** The strong assurances; "podés / puede / se puede" alone are weak (next to a doctor referral they are fine). */
// Verifier round 11: "segur…" but not "seguridad" ("por seguridad, consultá con tu médico" is caution, not a promise).
const STRONG_HEALTH_ASSURANCE = String.raw`segur(?!idad)\p{L}*|apt[oa]s?|(?:ning[uú]n|sin)\s+inconvenientes?|no\s+hay\s+(?:ning[uú]n\s+)?inconvenientes?|sin\s+(?:ning[uú]n\s+)?problemas?|no\s+hay\s+(?:ning[uú]n\s+)?problemas?|no\s+pasa\s+nada|tranquil\p{L}*|recomendad\p{L}*|ideal(?:es)?|perfect[oa]s?|efectos?\s+secundarios?|contraindicaci\p{L}*|riesgos?|peligros\p{L}*|da[nñ]in\p{L}*|hace\s+da[nñ]o|hacen\s+da[nñ]o|afecta\p{L}*|interact\p{L}*|interfier\p{L}*|compatible\p{L}*|inofensiv\p{L}*|inocu\p{L}*|sin\s+miedo|con\s+(?:toda\s+)?confianza|sin\s+pena|no\s+(?:le|te|les)\s+va\s+a\s+(?:hacer|pasar)\s+nada|va\s+bien|le\s+va\s+bien`
const STRONG_HEALTH_ASSURANCE_RE = new RegExp(String.raw`(?<![\p{L}])(?:${STRONG_HEALTH_ASSURANCE})(?![\p{L}])`, 'iu')
const HEALTH_ASSURANCE_RE = new RegExp(String.raw`(?<![\p{L}])(?:${STRONG_HEALTH_ASSURANCE}|pod[eé]s|puede[ns]?|pued[eé]s|se\s+puede|podr[ií]as?)(?![\p{L}])`, 'iu')
/** Names that only look like a sensitive group ("el Día del Niño"). */
const NOT_A_GROUP_RE = /d[ií]a\s+del?\s+ni[nñ][oa]s?/giu
const HEALTH_REFERRAL_RE =
  /(?<![\p{L}])(?:m[eé]dic[oa]s?|doctor\p{L}*|profesional(?:es)?\s+de\s+(?:la\s+)?salud|consult\p{L}*|ginec\p{L}*|pediatra|farmac[eé]utic\p{L}*)(?![\p{L}])/iu
/** "No es seguro", "no se recomienda", "no lo uses", "evitá": a warning, not an assurance. */
const HEALTH_WARNING_RE =
  /(?<![\p{L}])(?:no\s+(?:es|son|est[aá]|lo|la|los|las|se|te|le)?\s*(?:segur|apt|recomend|pod|pued|us|tom|deb)\p{L}*|evit\p{L}*|no\s+deber\p{L}*)(?![\p{L}])/iu

/** "No hay / no produce / libre de / cero / sin efectos secundarios", "no presenta contraindicaciones": always a promise. */
const NO_SIDE_EFFECTS_RE =
  /(?<![\p{L}])(?:no\s+(?:hay|tiene|tienen|produce|producen|presenta|presentan|causa|causan|da|dan|genera|generan)|libres?\s+de|cero|sin)\s+(?:ning[uú]n\s+|ningunos?\s+|ninguna\s+)?(?:efectos?\s+(?:secundarios?|adversos?|negativos?)|contraindicaci\p{L}*|reacci[oó]n(?:es)?\s+adversas?)/iu
/** A bare "no tiene / no hay ningún riesgo / peligro" — health unless the sentence is about paying or shipping. */
const NO_RISK_RE =
  /(?<![\p{L}])(?:(?:no\s+(?:tiene|tienen|hay|causa|causan|representa|representan)|cero|sin|libres?\s+de)\s+(?:ning[uú]n\s+|ni\s+un\s+)?(?:riesgos?|peligros?)(?:\s+alguno)?|no\s+(?:te\s+|le\s+|les\s+)?(?:hace|hacen|va\s+a\s+hacer|van\s+a\s+hacer)\s+(?:ning[uú]n\s+)?da[nñ]o|no\s+(?:genera|crea|causa|da)\s+(?:dependencia|adicci\p{L}*)|inofensiv\p{L}*|inocu[oa]s?)(?![\p{L}])/iu
// Verifier round 8: shipping / guarantee sentences ("el paquete va asegurado, cero riesgo", "comprá sin riesgo: si no te
// gusta lo cambiamos", "no hay peligro, el mensajero te llama") are not health.
const MONEY_OR_SHIPPING_RE =
  /(?<![\p{L}])(?:pag\p{L}*|sinpe|tarjeta|link|enlace|transfer\p{L}*|env[ií]o|enviamos|compra\p{L}*|compr[aá]|datos|web|p[aá]gina|paquete\p{L}*|mensajer\p{L}*|gu[ií]a|asegurad\p{L}*|garant\p{L}*|cambi\p{L}*|devol\p{L}*|pierd\p{L}*|perd\p{L}*|entrega\p{L}*)(?![\p{L}])/iu
/** "Para saber si es seguro…", "Sobre si podés…", "¿Podés usarlo con…?": an indirect question, not an assurance. */
const INDIRECT_RE = /(?<![\p{L}])(?:si|sobre\s+si|saber\s+si)\s+(?:\p{L}+\s+){0,2}?(?:es|son|pod\p{L}*|pued\p{L}*|se\s+puede)(?![\p{L}])/iu

/**
 * SecureDog round 6: every exemption belongs to the assurance PHRASE itself, not to its sentence. An occurrence is
 * exempt only when, right before it in its clause, there is a "no / nunca" ("no es seguro"), an indirect "si"
 * ("para saber si es seguro…", with a doctor referral in the reply), or when the weak "podés / puede" is a possibility
 * ("podés estar tomando…"). Anything else — "Es seguro en el embarazo, no debés preocuparte", "Sí, podés usarlo,
 * igual consultá con tu médico" — is an assurance.
 */
const ASSURANCE_GLOBAL_RE = new RegExp(HEALTH_ASSURANCE_RE.source, 'giu')
// SecureDog round 7: "no solo / no sólo / no únicamente / no nada más" is not a negation ("No solo es seguro, también…").
const NEGATED_BEFORE_RE = /(?<![\p{L}])(?:no(?!\s+(?:solo|s[oó]lo|[uú]nicamente|nada\s+m[aá]s)(?![\p{L}]))|nunca|jam[aá]s|ni)\s+(?:\p{L}+\s+){0,2}$/iu
const INDIRECT_BEFORE_RE = /(?<![\p{L}])(?:si|sobre\s+si|saber\s+si)\s+(?:\p{L}+\s+){0,2}$/iu
// SecureDog round 7: only "puede (ser) que…" and "podés estar tomando / estar con…" are a possibility — never "puede ser
// usado", "podés estar usándolo".
// Verifier round 12: "podría / puede causar enrojecimiento" is a disclosure of a possible effect, not a reassurance.
const POSSIBILITY_AFTER_RE = /^\s+(?:(?:ser\s+)?que|estar\s+(?:tomando|con|en\s+tratamiento|bajo)|(?:causar|provocar|irritar|generar|producir|dar)\p{L}*)(?![\p{L}])/iu
const WEAK_ASSURANCE_RE = /^(?:pod[eé]s|puede[ns]?|pued[eé]s|se\s+puede|podr[ií]as?)$/iu

/** Harm words: with a "no" in front they ARE the assurance ("no es peligroso", "no afecta", "no interactúa"). */
const HARM_WORD_RE = /^(?:riesgos?|peligros\p{L}*|da[nñ]in\p{L}*|hacen?\s+da[nñ]o|afecta\p{L}*|interact\p{L}*|interfier\p{L}*|efectos?\s+secundarios?|contraindicaci\p{L}*)$/iu

/** Every assurance occurrence in `s` that no exemption covers. */
function liveAssurances(s: string, referral: boolean): string[] {
  const out: string[] = []
  for (const m of s.matchAll(ASSURANCE_GLOBAL_RE)) {
    const idx = m.index ?? 0
    const clause = (s.slice(Math.max(0, idx - 40), idx).split(/[,;:¡!¿?]|\s(?:pero|aunque)\s/iu).pop() || '')
    if (!HARM_WORD_RE.test(m[0]) && NEGATED_BEFORE_RE.test(clause)) continue
    if (referral && INDIRECT_BEFORE_RE.test(clause)) continue
    if (WEAK_ASSURANCE_RE.test(m[0]) && POSSIBILITY_AFTER_RE.test(s.slice(idx + m[0].length))) continue
    if (WEAK_ASSURANCE_RE.test(m[0]) && referral && /(?<![\p{L}])(?:m[eé]dic[oa]|doctor\p{L}*|ginec\p{L}*|pediatra|farmac[eé]utic\p{L}*|[eé]l|ella)\s+(?:\p{L}+\s+){0,3}$/iu.test(clause)) continue
    // "¡Perfecto! ¿A qué provincia?": the interjection is not "perfect for you".
    if (/^perfect/iu.test(m[0]) && (!clause.trim() || /^\s*[!,.]/u.test(s.slice(idx + m[0].length)))) continue
    if (/(?<![\p{L}])no\s+(?:te\s+|le\s+|les\s+)?(?:puedo|podemos|sabr[ií]a|sabemos|conocemos)\s+(?:asegurar|garantizar|confirmar|decir)?/iu.test(s.slice(0, idx))) continue
    out.push(m[0])
  }
  return out
}

function liveAssuranceIn(s: string, referral: boolean): string | null {
  return liveAssurances(s, referral)[0] ?? null
}

export function healthAssuranceIn(text: string, opts: { instructions?: boolean } = {}): string | null {
  const t = (text || '').normalize('NFKC')
  // SecureDog round 7: in pack text a "…, pero …" half is judged on its own ("No prometemos milagros, pero es seguro en
  // el embarazo" is still a promise).
  const sentences = t
    .split(/(?<=[.!?\n;])\s*/u)
    .flatMap((s) => (opts.instructions ? s.split(/\s*,?\s+pero\s+/iu) : [s]))
    .filter((s) => s.trim())
  const referral = HEALTH_REFERRAL_RE.test(t)
  for (const s of sentences) {
    // "Nunca prometas…" is an instruction in the pack (lint only); in a live reply "no prometemos nada, pero…" is not.
    if (opts.instructions && DONT_SAY_RE.test(s)) continue
    if (NO_SIDE_EFFECTS_RE.test(s)) return s.trim()
    if (NO_RISK_RE.test(s) && !MONEY_OR_SHIPPING_RE.test(s)) return s.trim()
    if (!HEALTH_GROUP_RE.test(s.replace(NOT_A_GROUP_RE, ' '))) continue
    // A question back next to a doctor referral ("¿Con tus medicamentos? Eso lo tiene que decir tu médico").
    if (referral && /\?\s*$/u.test(s) && !/(?<![\p{L}])(?:s[ií]|claro)(?![\p{L}])/iu.test(s)) continue
    if (liveAssuranceIn(s, referral)) return s.trim()
  }
  return null
}

/** To a health question (pregnancy, medication, condition) any non-exempt "sí / podés / sin problema" is a promise. */
export function healthContextAssurance(reply: string, customerText: string): string | null {
  const c = (customerText || '').normalize('NFKC').replace(NOT_A_GROUP_RE, ' ')
  // Verifier round 10: "¿Es seguro comprar por aquí?" / "¿hay riesgo de que se pierda el paquete?" are about paying or
  // shipping — the bare safety words count only when the customer is not asking about money or delivery.
  // SecureDog round 8: judged per message — a shopping word in an EARLIER message ("Quiero comprar 2") no longer switches
  // the safety words of a later one ("¿Le hace daño a mi gastritis?") off.
  const safetyWords = c
    .split('\n')
    // Verifier round 12: "mal" only as "hace / cae mal" ("Duermo muy mal, ¿el de dormir sirve?" is not a safety question).
    .some((line) => /(?<![\p{L}])(?:segur\p{L}*|riesgo\p{L}*|da[nñ]o|peligro\p{L}*|efectos?\s+secundarios?|(?:hace|hacen|cae|caen)\s+mal)(?![\p{L}])/iu.test(line) && !MONEY_OR_SHIPPING_RE.test(line))
  if (!HEALTH_GROUP_RE.test(c) && !safetyWords) return null
  const t = (reply || '').normalize('NFKC')
  const referral = HEALTH_REFERRAL_RE.test(t)
  // "¡Claro! Podés usarlo sin problema": the "sí / claro" may sit in its own sentence.
  const affirmative = /(?<![\p{L}])(?:sí|si(?=\s*[,.!😊🙌💚]|\s*$)|claro|dale|obvio|por\s+supuesto)(?![\p{L}])/iu.test(t)
  for (const s of t.split(/(?<=[.!?\n;])\s*/u).filter((x) => x.trim())) {
    if (NO_RISK_RE.test(s)) return s.trim()
    const hits = liveAssurances(s, referral)
    if (hits.length && (affirmative || hits.some((h) => !WEAK_ASSURANCE_RE.test(h)))) return s.trim()
  }
  // SecureDog round 7: a bare answer is the promise itself — "No, para nada" / "No, ninguno" to a harm question, "¡Sí,
  // claro!" to "¿lo puedo usar / tomar…?" — unless the reply sends them to their doctor.
  const harmQuestion = /(?<![\p{L}])(?:da[nñ]o|segur\p{L}*|riesgo\p{L}*|peligro\p{L}*|efectos?\s+secundarios?|contraindicaci\p{L}*|afecta\p{L}*|(?:hace|hacen|cae|caen)\s+mal)(?![\p{L}])/iu.test(c)
  // SecureDog round 8: also "¿es seguro / es apto / sirve / se puede … en el embarazo?" (a bare "¡Sí!" answers those too).
  const canIQuestion = /(?<![\p{L}])(?:(?:lo|la|los|las)\s+)?(?:puedo|pueden|podr[ií]a|puede)\s+(?:usar|tomar|poner|aplicar|combinar)|(?:usar|tomar)l[oa]s?\b|(?<![\p{L}])(?:es|son)\s+(?:segur\p{L}*|apt[oa]s?|bueno|buena)|(?<![\p{L}])(?:se\s+puede|sirve)(?![\p{L}])/iu.test(c)
  // (A "Sí" to a harm question — "¿tiene efectos secundarios?", "¿hace daño?" — is a disclosure, never a promise.)
  const opening = t.trim().split(/[.!?\n]/u)[0] || ''
  if (!referral && harmQuestion && /^\s*¡?\s*(?:no|para\s+nada|ninguno|ninguna|nada|cero)(?![\p{L}])/iu.test(opening)) return opening.trim()
  if (!referral && canIQuestion && /^\s*¡?\s*(?:s[ií]|claro|dale|obvio|por\s+supuesto)(?![\p{L}])/iu.test(opening)) return opening.trim()
  return null
}

/** First results/health promise in the text (null = none). `instructions`: pack text (build-agent lint). */
export function resultsClaimIn(text: string, opts: { instructions?: boolean } = {}): string | null {
  const health = healthAssuranceIn(text, opts)
  if (health) return health
  const t = (text || '').normalize('NFKC')
  for (const re of RESULTS_CLAIM_RES) {
    for (const m of t.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
      // Only the same clause counts ("No te preocupes, resultado garantizado" is a promise) and reassurances are not a "no".
      const before = (t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0).split(/[,:;¡!]|\s(?:pero|y|aunque)\s/i).pop() || '').replace(NOT_A_NEGATION_RE, ' ')
      if (RESULTS_NEGATION_RE.test(before)) continue
      // "Nunca prometas curar, tratar o bajar de peso": one "don't say" covers the whole list in that sentence.
      if (opts.instructions && DONT_SAY_RE.test(sentenceBefore(t, m.index ?? 0))) continue
      return m[0]
    }
  }
  return null
}

/** Longest model reply checked at all (~700 output tokens is ~3 000 characters). */
export const MODEL_TEXT_MAX_CHARS = 4000

const WORD_START_CACHE = new Map<RegExp, RegExp>()
/** The same pattern, matched only where a word starts (for the accent-free form, INT-158). */
function fromWordStart(re: RegExp): RegExp {
  let edged = WORD_START_CACHE.get(re)
  if (!edged) {
    edged = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${re.source})`, re.flags.includes('u') ? re.flags : `${re.flags}u`)
    WORD_START_CACHE.set(re, edged)
  }
  return edged
}

export function validateAgentOutput(input: {
  text: string
  citedToolNames: string[]
  inventoryPrices?: number[]
  shippingAmounts?: number[]
  quoteAmounts?: number[]
  replyStyle?: ReplyStyle | null
  intent?: string | null
  /** Deal wording enabled by the owner's active promo (promo.ts). */
  allowedDeals?: Array<'free_shipping' | 'special_price'>
  /** Store rule "envío gratis desde ₡X" (only valid next to that amount). */
  freeShippingRule?: FreeShippingRule | null
  /** Lane C D6: prices of bundles stored with their shipping included (sales-state bundles shippingIncluded). */
  includedShippingAmounts?: number[]
  /** The customer's message: a reply about the state of a payment to a payment message is never sent (INT-93). */
  customerText?: string
  /** The conversation is about a payment (recent payment words / media / payment already discussed): same backstop. */
  paymentContext?: boolean
  /**
   * INT-109 / INT-112: what the reply may link (brandFactsLinkAllowlist). When given, any other link or domain in the
   * reply is 'foreign_link' (nothing configured → every link is foreign). Undefined = not checked.
   */
  linkAllowlist?: LinkAllowlist | null
  /**
   * The text the length rule is judged on (agents2-format): the reply BEFORE payment tokens were filled, so a
   * configured payment block counts as the one line the token was. Defaults to `text`.
   */
  styleText?: string
  /** The text links are judged on (the reply before payment tokens were filled). Defaults to `text`. */
  linkText?: string
  /** The model's own words (before payment tokens / the purchase summary) for the paymentContext check. Defaults to `text`. */
  paymentContextText?: string
  /** N3: the contra-entrega / efectivo closing turn — the order-confirmation wording check applies. */
  orderClosing?: boolean
  /** INT-158 H3: the text was written by the model — a letter outside Latin-1 / a stray combining mark is held. */
  modelText?: boolean
  /** Sleeping C3: the store's own per-unit rates (sales-state salesUnitRates). */
  unitRates?: UnitRate[] | null
  /** Sleeping C9: the store's own published text (brand facts) — its phones are never a data echo. */
  ownText?: string | null
  /** Out-of-stock switch (SQL 055): no close for a sold-out product, no invented "vuelve" date. */
  stockGuard?: StockGuard | null
}): OutputValidationResult {
  // Judged before payment tokens were filled (styleText): a [[PAGO_…]] token is a close.
  const reasons: string[] = stockProblems(input.styleText ?? input.text ?? '', input.stockGuard)
  const text = input.text || ''
  // INT-158 r2 F4/F11: a model reply this long is never a real answer; held before any pattern runs on it.
  if (input.modelText && text.length > MODEL_TEXT_MAX_CHARS) return { ok: false, needsHuman: true, reasons: ['model_text_too_long'], highlightedAmounts: [] }
  const cited = new Set(input.citedToolNames)
  const highlighted: number[] = []

  // Links are judged on the text BEFORE code filled payment tokens (linkText): the card link code adds from
  // configuration needs no allowlist entry, and the allowlist never widens to a whole payment host (Verifier F2).
  if (input.linkAllowlist && foreignLinks(input.linkText ?? text, input.linkAllowlist).length > 0) reasons.push('foreign_link')
  if (UNIT_COST_RE.test(text)) reasons.push('unit_cost_leak')
  if (asksCardData(input.styleText ?? text)) reasons.push('card_data_request')
  // Sleeping C9: a reply that is only a personal-data block (someone's name / phone / address copied from the chat).
  if (isPersonalDataEcho(input.styleText ?? text, input.ownText)) reasons.push('data_echo')
  // Sleeping C7: the customer asked again — "ya te lo compartí / ya te lo dije" refuses an answer it can give.
  if (REPEAT_REFUSAL_RE.test(text)) reasons.push('repeat_refusal')
  // INT-158 H4: the sibling claim checks read every form the confirmation-wording check reads (raw, normalised —
  // invisible characters, look-alikes, WhatsApp markup, odd separators — without accents, and the look-alike
  // skeleton). These patterns have no word edges, so the accent-free and skeleton forms are matched from a word start
  // only ("arnés corrector" would otherwise read "es correct…").
  const textForms = confirmationCheckForms(text)
  const anyForm = (re: RegExp, forms: string[]) => forms.some((form, i) => (i >= 2 ? fromWordStart(re) : re).test(form))
  if (anyForm(CREATED_CLAIM_RE, textForms) || (input.orderClosing && anyForm(ORDER_CLOSING_CLAIM_RE, textForms))) {
    reasons.push('write_claim')
  }
  if (dealProblemWithRule(maskIncludedShipping(text, input.includedShippingAmounts), input.allowedDeals ?? [], input.freeShippingRule)) reasons.push('deal_offer')
  // v53 tests 2026-10-18: a conditional next-step participle ("una vez confirmado el pago, sale…") is not a claim; only
  // that participle is masked (shortcuts.ts maskConditionalConfirmation), for this check and the payment-status ones.
  const claimText = maskConditionalConfirmation(text)
  const claimForms = confirmationCheckForms(claimText)
  // Verifier r3 #5: the model-only / context checks read the model's own words when the final policy gives them
  // (paymentContextText: before the owner's payment blocks and the purchase summary).
  const modelForms = input.paymentContextText !== undefined ? confirmationCheckForms(maskConditionalConfirmation(input.paymentContextText)) : claimForms
  const paymentInPlayEarly = Boolean(input.paymentContext || (input.customerText && hasPaymentWord(input.customerText)))
  if (hasOutboundConfirmationClaim(text)) reasons.push('confirmation_wording')
  if (input.modelText && hasUnsafeLetters(input.styleText ?? text)) reasons.push('unsafe_letters')
  if (resultsClaimIn(text)) reasons.push('results_claim')
  // SecureDog round 5 (INT-138): to a pregnancy / medication question, "¡Sí! Podés usarlo sin problema" with no doctor
  // referral is the same promise.
  // SecureDog round 6: a doctor referral no longer cancels it, and the customer text is the whole burst.
  else if (input.customerText && healthContextAssurance(text, input.customerText)) {
    reasons.push('results_claim')
  }
  // Advisor (luna-10): the unmistakable "payment received" wordings are held on EVERY reply, payment words or not.
  // The wave-D list reads model text only (an owner's saved line may say "¡Gracias por la transferencia!").
  if (
    anyForm(ALWAYS_PAYMENT_STATUS_REPLY_RE, claimForms) ||
    (input.modelText && (anyForm(MORE_DONE_REPLY_RE, modelForms) || hasPaidStatement(modelForms)))
  ) {
    reasons.push('payment_status_claim')
  } else if (
    (input.paymentContext &&
      // Verifier r2 #2: a payment context given by the final policy judges the MODEL's words only (paymentContextText:
      // before payment tokens were filled and before the purchase summary), never the owner's configured blocks.
      anyForm(
        PAYMENT_STATUS_REPLY_RE,
        modelForms,
      )) ||
    (input.customerText && hasPaymentWord(input.customerText) && anyForm(PAYMENT_STATUS_REPLY_RE, modelForms))
  ) {
    reasons.push('payment_status_claim')
  } else if (
    input.customerText &&
    (mentionsConfirmVerb(input.customerText) ||
      isStatusQuestion(input.customerText) ||
      isPaymentStatusQuestion(input.customerText, paymentInPlayEarly)) &&
    (anyForm(CONFIRM_ASK_STATUS_REPLY_RE, claimForms) ||
      // SecureDog r3 INT-169: a short whole-reply affirmation with no question ("¡Claro que sí!", "¡Hecho!", "Correcto 👍")
      // to a confirm ask reads as "your payment is fine".
      isAffirmOnly(text) ||
      // SecureDog r4 #4: to a confirm ask the agent asks what to confirm or moves the sale on — a reply with no question
      // ("¡Así es!", "¡Sí, con gusto!", "¡Sí! Tu pedido sale hoy") is held.
      // Verifier r7 #2: a direct ask ("pasame estos datos", "contame qué producto", a data list) counts as asking.
      (mentionsConfirmVerb(input.customerText) && !/[?¿]/.test(text) && !DIRECT_ASK_RE.test(text)) ||
      (isPaymentStatusQuestion(input.customerText, paymentInPlayEarly) && !/[?¿]/.test(text) && !DIRECT_ASK_RE.test(text) && !DEFERS_TO_TEAM_RE.test(text)) ||
      // SecureDog wave D r2: to a status question ("¿Ya está?", "¿Les llegó?") a reply that starts with a yes.
      (isPaymentStatusQuestion(input.customerText, paymentInPlayEarly) && startsWithAffirmation(text)))
  ) {
    // SecureDog r1 INT-159 / Verifier r3 #3: a reply to a confirm ask ("¿me confirmás?") may not say a payment arrived
    // ("¡Sí, nos llegó!", "¡Perfecto, ya está!", "todo en orden") — but "¡Claro, sin problema!" stays a sales answer.
    reasons.push('payment_status_claim')
  }
  // SecureDog wave D r2 (M1): a model reply in English / PT / FR. With payment in play it is a payment hold; otherwise
  // it is repaired / held like any other off-rule reply.
  const paymentInPlay = paymentInPlayEarly
  const ownNames = paymentInPlay ? (input.ownText ?? '') : null
  if (input.modelText && readsAsForeignLanguage(input.paymentContextText ?? text, ownNames)) {
    reasons.push(paymentInPlay ? 'payment_status_claim' : 'non_spanish_reply')
  } else if (input.modelText && paymentInPlay && FOREIGN_STATUS_WORD_RE.test(languageWords(input.paymentContextText ?? text, ownNames))) {
    reasons.push('payment_status_claim')
  }
  // SecureDog r4 (INT-206, structural): with payment in play, to ANY customer question a reply that starts with a yes or
  // is only emoji is rewritten (repairable) — "¡Claro que sí!" to "¿Todo en orden?" / "¿Novedades?" never goes out as is.
  // A real payment status question is already a payment hold above.
  // Verifier final: only to a short, status-shaped question (no product / price / shipping word), and never on the
  // payment-details step ("¡Perfecto! 🙌\n[[PAGO_SINPE]]").
  if (
    input.modelText &&
    paymentInPlay &&
    input.customerText &&
    hasShortStatusShapedQuestion(input.customerText) &&
    !/\[\[\s*(?:PAGO|DATOS_PAGO)/iu.test(text) &&
    !reasons.includes('payment_status_claim') &&
    [input.paymentContextText ?? text].some(
      (t) => startsWithAffirmation(t) || startsWithAffirmation(t.replace(/^[\s¡!]*hola[\s,.!¡]*/iu, '')) || isAffirmOnly(t),
    )
  ) {
    reasons.push('affirm_first')
  }

  const inventory =
    cited.has('search_inventory') && Array.isArray(input.inventoryPrices)
      ? input.inventoryPrices
      : []
  const shipping = input.shippingAmounts || []
  const quote = input.quoteAmounts || []
  const allowed = [...inventory, ...shipping, ...quote]
  const amounts = extractMoneyAmounts(text).filter((amount) => Math.round(amount) >= 100)

  if (MONEY_RE.test(text) && amounts.length === 0 && allowed.length === 0 && !cited.has('search_inventory')) {
    reasons.push('unsourced_money')
  }

  for (const amount of amounts) {
    if (amountAllowed(amount, allowed)) continue
    // Sleeping C3: a per-night / per-patch amount that is a known price ÷ a stated count.
    if (unitDerivedAmount(amount, text, input.unitRates)) continue
    // Pura Sonrisa P2 (INT-84 kept): the store's threshold amount only inside its own threshold-rule clause.
    if (thresholdAmountOk(amount, text, input.freeShippingRule)) continue
    highlighted.push(Math.round(amount))
    if (!cited.has('search_inventory') && shipping.length === 0 && quote.length === 0) {
      reasons.push('unsourced_money')
    } else if (cited.has('search_inventory') && !amountAllowed(amount, inventory)) {
      reasons.push('money_mismatch_inventory')
    }
    reasons.push('unsourced_amount')
    break
  }

  const style = input.replyStyle
  if (style) {
    // agents2-format: the limit is PER MESSAGE (each blank-line block goes out on its own, max 3), a dash list counts
    // as one line.
    const parts = splitReplyParts(input.styleText ?? text)
    if (parts.some((part) => messageLineCount(part) > style.maxLines + 2)) reasons.push('style_too_long')
  }

  const needsHuman = reasons.length > 0
  return {
    ok: !needsHuman,
    needsHuman,
    reasons: [...new Set(reasons)],
    highlightedAmounts: highlighted,
  }
}

/** Any payment token line ([[DATOS_PAGO]], [[PAGO_SINPE]], …, also with one bracket). */
const PAYMENT_TOKEN_LINE_RE = /\[\[?\s*(?:DATOS[_\s-]?PAGO|PAGO[_\s-]?(?:SINPE|TRANSFERENCIA|TARJETA|CONTRA[_\s-]?ENTREGA|EFECTIVO))\s*\]?\]/i

// agents2-format: a reply goes out as separate messages (reply-parts.ts, client-safe).
export { MAX_REPLY_PARTS, splitReplyParts }

const LIST_ITEM_RE = /^\s*(?:[-•*–]|\d{1,2}[.)])\s+\S/

/** A dash list counts as one line only up to this many items (a longer list counts item by item). */
export const LIST_AS_ONE_LINE_MAX = 8
/**
 * The fixed shipping data list (7) + business fields: up to this many items still count as one line, so a data
 * request is never "too long" (2026-10-16). Only for a list that holds the fixed list.
 */
export const DATA_LIST_AS_ONE_LINE_MAX = 12

/** Lines of one message: a run of list items ("- …", "• …", "1. …") counts as ONE line (up to 8 items). */
export function messageLineCount(part: string): number {
  return unitsWeight(messageUnits(part))
}

const unitWeight = (unit: string[]) => {
  const max = unit.length > LIST_AS_ONE_LINE_MAX && unit.join('\n').includes(SHIPPING_DATA_LIST) ? DATA_LIST_AS_ONE_LINE_MAX : LIST_AS_ONE_LINE_MAX
  return unit.length > max ? unit.length : 1
}
const unitsWeight = (units: string[][]) => units.reduce((n, u) => n + unitWeight(u), 0)

/** Units of one message: a single line, or a whole run of list items. */
function messageUnits(part: string): string[][] {
  const units: string[][] = []
  let list: string[] | null = null
  for (const line of (part || '').split('\n')) {
    if (!line.trim()) {
      list = null
      continue
    }
    if (LIST_ITEM_RE.test(line)) {
      if (!list) {
        list = []
        units.push(list)
      }
      list.push(line)
    } else {
      list = null
      units.push([line])
    }
  }
  return units
}

/** Shorten ONE message (B3 rules, per message): null when it cannot be shortened safely. */
function shortenPart(part: string, limit: number): string | null {
  const units = messageUnits(part)
  if (unitsWeight(units) <= limit + 2) return part
  const keep = new Set<number>()
  units.forEach((unit, i) => {
    // A payment token and a list (the data the customer must send) are never dropped.
    if (unit.some((line) => PAYMENT_TOKEN_LINE_RE.test(line)) || unit.length > 1 || LIST_ITEM_RE.test(unit[0])) keep.add(i)
  })
  for (let i = units.length - 1; i >= 0; i -= 1) {
    if (unit2text(units[i]).match(/[?¿]/)) {
      keep.add(i)
      break
    }
  }
  const kept = () => unitsWeight([...keep].map((i) => units[i]))
  for (let i = 0; i < units.length && kept() < limit; i += 1) keep.add(i)
  // SecureDog INT-99: never drop a line that qualifies something (an amount, shipping, a negation, the assistant
  // disclosure) or holds part of a payment token — dropping it can change the meaning. Then the reply is not shortened
  // (it stays too long → the safe line goes out instead).
  const dropped = units.filter((_, i) => !keep.has(i)).flat()
  if (dropped.some((line) => QUALIFYING_LINE_RE.test(line))) return null
  return [...keep].sort((a, b) => a - b).map((i) => unit2text(units[i])).join('\n')
}

const unit2text = (unit: string[]) => unit.join('\n')

/**
 * B3: keep each message within maxLines (agents2-format: per message, a list counts as one line): the first lines, the
 * payment-token line, every list and the last question (the next step of the sale) are kept, in their original order.
 * Pure; never adds words. Unchanged text when nothing needs (or may be) shortened.
 */
export function shortenToMaxLines(text: string, maxLines: number): string {
  const limit = Math.max(1, Math.floor(maxLines))
  const parts = splitReplyParts(text)
  if (parts.every((part) => messageLineCount(part) <= limit + 2)) return text
  const out: string[] = []
  for (const part of parts) {
    const short = shortenPart(part, limit)
    if (short === null) return text
    out.push(short)
  }
  return out.join('\n\n')
}

/**
 * "SINPE 8888 · transferencia BAC · también tarjeta" — one line joined with " · " is unreadable on WhatsApp
 * (agents2-format): a line with two or more " · " separators becomes a dash list (one item per line; a lead-in ending
 * in ":" stays as its own line). Same words, same order; a list is one unit, so shortening never drops an item.
 */
export function unjoinDotSeparated(text: string): string {
  return (text || '')
    .split('\n')
    .map((line) => {
      const pieces = line.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean)
      if (pieces.length < 3) return line
      const colon = pieces[0].indexOf(':')
      const lead = colon >= 0 ? pieces[0].slice(0, colon + 1).trim() : ''
      if (colon >= 0) pieces[0] = pieces[0].slice(colon + 1).trim()
      const items = pieces.filter(Boolean).map((p) => `- ${p}`)
      return [lead, ...items].filter(Boolean).join('\n')
    })
    .join('\n')
}

const QUALIFYING_LINE_RE = /[₡¢$]|\d{3}|env[ií]o|(?<![\p{L}])(no|nunca|sin|solo|excepto)(?![\p{L}])|asistente\s+virtual|\[\[|\]\]|DATOS|PAGO/iu

/** Anything token-like left after code filled the payment tokens (never sent; a person looks). */
// Also single-bracket "[PAGO …]" / "[DATOS …]", "PAGO_SINPE" / "PAGO-SINPE" and the upper-case "DATOS PAGO" (SecureDog).
const LEFTOVER_TOKEN_RE = /\[\[|\]\]|[【】]|\[\s*(?:PAGO|DATOS)\b|PAGO[_-]\p{L}|DATOS_(?:DE_)?PAGO|DATOS[ -](?:DE[ -])?PAGO(?![\p{Ll}])/u
const LEFTOVER_TOKEN_STRIP_RE = /\[\[[^\]\n]{0,60}\]\]|【[^】\n]{0,60}】|\[\s*(?:PAGO|DATOS)[^\]\n]{0,40}\]|\[\[|\]\]|[【】]|(?<![\p{L}])(?:PAGO[_-][\p{L}_-]*|DATOS_(?:DE_)?PAGO|DATOS[ -](?:DE[ -])?PAGO)(?![\p{L}])/u

export type FinalOutputPolicy = {
  text: string
  ok: boolean
  needsHuman: boolean
  reasons: string[]
  purchaseSummaryAppended: boolean
  highlightedAmounts: number[]
  intent: string
  /** The separate messages the text goes out as (splitReplyParts). */
  parts: string[]
  /** Payment tokens code filled ('all' = [[DATOS_PAGO]]); a filled contra-entrega token = an order ready for a person. */
  paymentMethods: Array<TokenPaymentMethod | 'all'>
}

export function applyFinalOutputPolicy(input: {
  text: string
  intent?: string | null
  citedToolNames?: string[]
  inventoryPrices?: number[]
  quoteAmounts?: number[]
  brandFacts?: BrandFacts | null
  replyStyle?: ReplyStyle | null
  shortcuts?: RuntimeShortcut[]
  /** Sales flow active: it decides when shipping/payment are said, so no automatic summary (it repeated itself). */
  skipPurchaseSummary?: boolean
  /** The customer's own message (numbers they wrote may be repeated back). */
  customerText?: string
  allowedDeals?: Array<'free_shipping' | 'special_price'>
  /** Promo makes shipping free: the store's fixed shipping amounts stop being valid. */
  freeShipping?: boolean
  freeShippingRule?: FreeShippingRule | null
  /** Lane C D6: prices of bundles stored with their shipping included (sales-state bundles shippingIncluded). */
  includedShippingAmounts?: number[]
  /**
   * Agentes IA 2.0 (B3): a model reply longer than the style allows is shortened by code (first lines + the payment
   * line + the final question) instead of being held for a person. Off for the owner's own saved replies.
   */
  shortenLongReply?: boolean
  /**
   * INT-109 / INT-112: the text was written by the model (live turn / Probar, same runtime allowlist): any link not on
   * it is 'foreign_link'. Not given for the owner's own saved replies sent by code (inbound-decision).
   */
  linkAllowlist?: LinkAllowlist | null
  /** Sales flow: contra entrega offered by a shipping method (agent-sales-context) for [[PAGO_CONTRA_ENTREGA]]. */
  paymentOptions?: PaymentFillOptions
  /** INT-158 H3: the text was written by the model (live turn / Probar): letters outside Latin-1 are held. */
  modelText?: boolean
  /** SecureDog INT-205: the chat is about a payment (runtime conversationPaymentContext): the SENT (shortened) text gets the payment-status checks too. */
  paymentContext?: boolean
  /** Sleeping C3: the store's own per-unit rates (sales-state salesUnitRates). */
  unitRates?: UnitRate[] | null
  /** Out-of-stock switch (SQL 055): same stock checks as the runtime (live turn + Probar). */
  stockGuard?: StockGuard | null
}): FinalOutputPolicy {
  const facts = input.brandFacts || { schemaVersion: 1 }
  const style = input.replyStyle || DEFAULT_REPLY_STYLE
  const intent = (input.intent || 'other') as AgentIntent
  const shippingAmounts = input.freeShipping ? [] : shippingProvenanceAmounts(facts)
  // INT-158 H2: no bidi controls go out, so the text checked below is the text the customer sees (and is sent).
  let text = stripBidiControls(input.text || '').trim()
  // INT-158 r2 F4: a model reply this long is never sent and never parsed (bounds every pattern below).
  if (input.modelText && text.length > MODEL_TEXT_MAX_CHARS) {
    return {
      text: '',
      ok: false,
      needsHuman: true,
      reasons: ['model_text_too_long'],
      purchaseSummaryAppended: false,
      highlightedAmounts: [],
      intent,
      parts: [],
      paymentMethods: [],
    }
  }
  let purchaseSummaryAppended = false
  const reasons: string[] = []
  // Backstop: an unrendered template ({{brand.…}}) or a leftover [[ATAJO…]] never reaches the customer.
  if (/\{\{[^}]{0,80}\}\}/.test(text)) {
    text = text.replace(/\{\{[^}]{0,80}\}\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
    reasons.push('template_leak')
  }
  text = extractShortcutTag(text).text
  if (input.shortenLongReply) {
    // agents2-format: "a · b · c" on one line becomes one line per item (model text only; same words).
    const unjoined = unjoinDotSeparated(text)
    if (unjoined !== text) {
      text = unjoined
      reasons.push('unjoined')
    }
  }
  // Rafael 2026-10-16 (not negotiable): a shipping-data request goes out as the exact fixed list (after unjoining, so
  // a dot-joined request is caught too; before shortening, so the list is kept whole).
  const canonicalList = canonicalizeOrderDataList(text)
  if (canonicalList !== text) {
    text = canonicalList
    reasons.push('data_list')
  }
  // Sleeping C6 (Rafael's rule): at the close the data list goes before the payment question, each in its own message.
  // Before shortening (Verifier r1 #2): the reordered messages are then shortened like any reply.
  if (input.paymentOptions?.dataListFirst) {
    const fits = (message: string) => messageLineCount(message) <= style.maxLines + 2
    const ordered = dataListBeforePaymentQuestion(text, input.paymentOptions.dataListFirst, fits)
    // Verifier r2 #4: never turn a sendable reply into a too-long one — keep the original when the reorder cannot fit.
    const shortened = input.shortenLongReply ? shortenToMaxLines(ordered, style.maxLines) : ordered
    if (ordered !== text && splitReplyParts(shortened).every(fits)) {
      // SecureDog r1 INT-163: the claim wording is also judged on the text as the model wrote it (line breaks and all).
      if (hasOutboundConfirmationClaim(text)) reasons.push('confirmation_wording')
      // SecureDog r2 INT-163: the written-claim and "payment received" checks too ("Tu pedido\nquedó anotado").
      const preForms = confirmationCheckForms(text)
      const inAnyForm = (re: RegExp) => preForms.some((form) => re.test(form))
      if (inAnyForm(CREATED_CLAIM_RE)) reasons.push('write_claim')
      if (inAnyForm(ALWAYS_PAYMENT_STATUS_REPLY_RE)) reasons.push('payment_status_claim')
      text = ordered
      reasons.push('data_list_first')
    }
  }
  if (input.shortenLongReply) {
    const short = shortenToMaxLines(text, style.maxLines)
    if (short !== text) {
      text = short
      reasons.push('shortened')
    }
  }
  // Anything still spelling the internal tag (case-sensitive) is never sent.
  if (/ATAJO/.test(text)) reasons.push('tag_leak')
  // Nothing left to send = no reply (never an empty WhatsApp message).
  if (!text) reasons.push('empty_output')
  // Payment identifiers come from configuration only (INT-69): fill the token, then every payment-looking number
  // must be a configured one (when shareable) or one the customer wrote.
  // The length rule is judged with each token as its one line (a configured payment block is not "too long").
  let styleText = text
  // The model's own words, tokens stripped: the paymentContext check never reads the owner's filled payment blocks.
  const paymentContextText = text.replace(new RegExp(LEFTOVER_TOKEN_STRIP_RE.source, 'gu'), ' ')
  const filled = fillPaymentToken(text, facts, { ...input.paymentOptions, customerText: input.paymentOptions?.customerText ?? input.customerText ?? undefined })
  text = filled.text
  if (filled.needsHuman) reasons.push('payment_info_not_shared')
  // Any other [[…]] left (an unknown / invented token) is never sent: stripped, and a person looks (Verifier #4).
  // SecureDog INT-118a: also half tokens, 【…】 look-alikes and bare PAGO_ / DATOS_PAGO / DATOS_DE_PAGO words.
  if (LEFTOVER_TOKEN_RE.test(text)) {
    text = text
      .replace(new RegExp(LEFTOVER_TOKEN_STRIP_RE.source, 'gu'), '')
      .split('\n')
      .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
      .join('\n')
      .trim()
    styleText = styleText.replace(new RegExp(LEFTOVER_TOKEN_STRIP_RE.source, 'gu'), '')
    reasons.push('unknown_token')
  }
  reasons.push(...paymentNumberProblems({ text, facts, customerText: input.customerText }))

  const hasMoney = extractMoneyAmounts(text).some((amount) => Math.round(amount) >= 100)
  const purchaseIntent = PURCHASE_INTENTS.has(intent)
  const incomplete =
    !input.skipPurchaseSummary &&
    purchaseIntent &&
    hasMoney &&
    style.purchaseInfoMustBeComplete &&
    (!SHIP_CUE_RE.test(text) || !PAY_CUE_RE.test(text))

  if (incomplete) {
    const summary = shortcutByKey(input.shortcuts || [], 'sys_purchase_summary')
    const rendered = summary
      ? renderShortcutTemplate(summary.body, { facts }).trim()
      : ''
    if (!purchaseSummaryRenderable(facts) || !rendered || !SHIP_CUE_RE.test(rendered) || !PAY_CUE_RE.test(rendered)) {
      reasons.push('brand_facts_missing')
    } else if (!text.includes(rendered)) {
      text = `${text}\n${rendered}`.trim()
      styleText = `${styleText}\n${rendered}`.trim()
      purchaseSummaryAppended = true
      reasons.push('purchase_summary_appended')
    }
  }

  const validated = validateAgentOutput({
    text,
    citedToolNames: input.citedToolNames || [],
    inventoryPrices: input.inventoryPrices,
    shippingAmounts,
    quoteAmounts: input.quoteAmounts,
    replyStyle: style,
    intent,
    allowedDeals: input.allowedDeals,
    freeShippingRule: input.freeShippingRule,
    includedShippingAmounts: input.includedShippingAmounts,
    customerText: input.customerText,
    paymentContext: input.paymentContext,
    paymentContextText,
    // INT-109: live and Probar both come through here — a reply may only link the brand's own site.
    linkAllowlist: input.linkAllowlist ?? undefined,
    styleText,
    linkText: styleText,
    modelText: input.modelText,
    unitRates: input.unitRates,
    ownText: JSON.stringify(facts),
    stockGuard: input.stockGuard,
    orderClosing:
      filled.methods.some((m) => m === 'contra_entrega' || m === 'efectivo') ||
      input.paymentOptions?.chosenMethod === 'contra_entrega' ||
      input.paymentOptions?.chosenMethod === 'efectivo',
  })

  const merged = [...new Set([...reasons, ...validated.reasons])]
  const blocking = merged.filter((reason) => reason !== 'purchase_summary_appended' && reason !== 'shortened' && reason !== 'unjoined' && reason !== 'data_list' && reason !== 'data_list_first')
  return {
    text,
    ok: blocking.length === 0,
    needsHuman: blocking.length > 0,
    reasons: merged,
    purchaseSummaryAppended,
    highlightedAmounts: validated.highlightedAmounts || [],
    intent,
    // agents2-format: the messages this reply goes out as (split last, after every check ran on the whole text).
    parts: splitReplyParts(text),
    paymentMethods: filled.methods,
  }
}
