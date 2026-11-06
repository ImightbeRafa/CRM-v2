/**
 * Follow-ups v2 (Rafael 2026-10-28, DeepSleep 7-day review): pure checks on the chat's last messages that make a
 * follow-up a wrong send, whatever its text. Seen live: "¿Te quedó alguna duda?" after the customer had sent size +
 * address or got the SINPE details, after "espero la quincena" / "ahorita no tengo plata", after "mañana le escribo".
 * No DB, no server-only: follow-up.ts reads the messages and calls this.
 */
import { isPaymentMethodQuestion, paidAfterDetails, paymentDetailsIn } from '@/lib/soft-ai/sales-state'
import { classifyPaymentText, isShortDoneBubble } from '@/lib/soft-ai/payment-classifier'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import { looksLikeOrderData as customerGaveOrderData } from '@/lib/soft-ai/order-data-list'

export { customerGaveOrderData }

export type FollowUpStateMessage = { direction: string; content?: string | null; messageType?: string | null }
/** A photo / file / audio placeholder or a file name ("[image]", "comprobante_sinpe.pdf"). */
const MEDIA_LIKE_RE = /\[(?:image|imagen|foto|audio|voice|video|document|documento|archivo|file|sticker)\]|^\s*\[[a-z_]+\]\s*$|\.(?:pdf|jpe?g|png|heic|webp)(?![\p{L}])/iu
/** SecureDog INT-242 r2: a sent / done verb the claim rules may miss ("Le acabo de mandar", "ya le hice"). Reminder only. */
const SENT_VERB_RE =
  /(?<![\p{L}])(?:acab[oéeó]\s+de|ya\s+(?:le|te|les|lo|la)\b|mand[eéoó]|envi[eéoó]|pas[eéoó]|hic[eé]|hizo|transfer\p{L}*|deposit\p{L}*|consign\p{L}*|abon\p{L}*|cancel[eéoó]|sinpe[eéoó]|dej[eéoó]|entregu[eé]|entreg[oó]|met[ií]|meti[oó]|list[oa]|hech[oa])(?![\p{L}])/iu
export type FollowUpStateSkip = 'payment_details_sent' | 'data_given' | 'waiting_date'

/**
 * The customer named a later moment or has no money right now (follow-ups are only sent inside Meta's 23 h window, so
 * a named date is a skip, never a scheduled nudge).
 */
export const WAITING_DATE_RE = new RegExp(
  [
    'quincena',
    'fin\\s+de\\s+mes',
    'cuando\\s+(?:me\\s+)?paguen',
    'cuando\\s+(?:tenga|reciba)\\s+(?:la\\s+)?(?:plata|platica|dinero|pago|salario)',
    'no\\s+tengo\\s+(?:plata|platica|dinero|presupuesto)',
    'ahorita\\s+no\\s+(?:tengo|puedo|me\\s+alcanza)',
    // Not "no me alcanza para el pack, mejor solo una" (a smaller order, still buying).
    'no\\s+me\\s+alcanza(?!\\s+para\\s+(?:el|la|los|las|un|una|dos)\\b)',
    '(?:la\\s+)?(?:otra|pr[oó]xima)\\s+semana',
    'aguinaldo',
    // "Sería para después del 15 noviembre", "hasta el viernes", "después de la quincena".
    '(?:para\\s+)?(?:despu[eé]s|hasta)\\s+(?:del?|el|la)\\s+(?:\\d{1,2}|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|quincena|mes)',
    // "Mañana le escribo", "El lunes les aviso", "Luego te confirmo": a promise to come back.
    '(?:ma[nñ]ana|luego|despu[eé]s|el\\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))\\s+(?:(?:yo\\s+)?(?:le|te|les)\\s+)?(?:escribo|aviso|confirmo|hablo|contacto|pido|compro|encargo|digo)',
    '(?:le|te|les)\\s+(?:escribo|aviso|confirmo)\\s+(?:ma[nñ]ana|luego|despu[eé]s|el\\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|la\\s+otra\\s+semana)',
  ].map((p) => `(?<![\\p{L}])${p}(?![\\p{L}])`).join('|'),
  'iu',
)

/**
 * Why this chat must not get a follow-up from its messages (newest first or oldest first, any order), or null.
 * Only the customer's LAST message decides a named date (an old "mañana le escribo" followed by new questions is fine).
 */
export function followUpStateSkip(messages: readonly FollowUpStateMessage[], newestFirst = true): FollowUpStateSkip | null {
  const ordered = newestFirst ? messages : [...messages].reverse()
  if (ordered.some((m) => m.direction === 'outbound' && paymentDetailsIn(m.content || ''))) return 'payment_details_sent'
  if (ordered.some((m) => m.direction === 'inbound' && customerGaveOrderData(m.content || ''))) return 'data_given'
  const lastIn = ordered.find((m) => m.direction === 'inbound')
  if (customerNamedLaterDate(ordered)) return 'waiting_date'
  return null
}

/** The customer's LAST message names a later moment (newest first). A date question ("¿Llega hasta el viernes?") is not. */
export function customerNamedLaterDate(newestFirst: readonly FollowUpStateMessage[]): boolean {
  const lastIn = newestFirst.find((m) => m.direction === 'inbound')
  return Boolean(lastIn && !/[?¿]/u.test(lastIn.content || '') && WAITING_DATE_RE.test(lastIn.content || ''))
}

/**
 * Follow-ups v2, the challenger arm: where the chat stopped. The store writes one text per slot (owner-approved, in the
 * pack's follow-up.json); a slot with no text uses the round's own text.
 *   chose             — the customer picked something ("Quiero una bolsa", "XL", "Sería el de correr") and went quiet
 *   quoted            — the store gave a price (₡) and the customer went quiet (no later size / how-it-works / data ask)
 *   size              — last stage was size / talla / peso
 *   how_it_works      — last stage was how it works / video / demo
 *   shipping_details  — the store asked for order data (nombre / dirección / …) and the customer went quiet
 *   sinpe_reminder    — the store sent its payment details and no receipt / paid message came after them
 *   pay_pending       — Pura Sonrisa 2026-11-05: the customer sent the order data after the store asked for it, the
 *                       agent's last message asks how to pay, no payment details yet (only arms with this text nudge)
 */
export type FollowUpSlot = 'chose' | 'quoted' | 'size' | 'how_it_works' | 'shipping_details' | 'sinpe_reminder' | 'pay_pending'
export const FOLLOW_UP_SLOTS: readonly FollowUpSlot[] = ['chose', 'quoted', 'size', 'how_it_works', 'shipping_details', 'sinpe_reminder', 'pay_pending']

/** The customer picked a product, size, quantity or pack (one bubble, not a question). */
const CHOSE_RE =
  /(?<![\p{L}])(?:(?:lo|la|los|las)\s+quiero|quiero\s+(?:un|una|uno|dos|el|la|los|las|\d)|me\s+(?:gustar[ií]a|interesa)\s+(?:el|la|un|una|uno|ordenar|pedir|llevar)|me\s+llevo|ser[ií]a\s+(?:el|la|un|una|uno|talla|\d)|talla\s+\p{L}|(?:x{0,3}l|[2-5]xl|m\/l)|(?:una|un|1|2|dos|tres)\s+(?:sola\s+)?(?:bolsa|bolsas|paquete|paquetes|caja|cajas|kit|kits|unidad|unidades|arn[eé]s)|el\s+pack|el\s+combo|solo\s+(?:una|uno|1))(?![\p{L}])/iu

/** Customer asked about size / weight (DeepSleep 2026-11-03). */
const SIZE_ASK_RE =
  /(?<![\p{L}])(?:talla|tallas|gu[ií]a\s+de\s+tallas|peso|pes[oó]|kilos?|\d+\s*kg|mido|estatura|medidas?|me\s+queda)(?![\p{L}])/iu
/** Store actually answered a size (table / "te queda XL"), not merely offered the guide after a price. */
const SIZE_ANSWER_RE =
  /(?<![\p{L}])(?:el\s+peso\s+(?:es\s+)?(?:el\s+que\s+)?manda|te\s+queda\s+(?:talla\s+)?(?:x{0,3}l|[2-5]xl|m\/l)|(?:M\/L|XL|2XL|3XL|4XL)\s*51|51\s*[–-]\s*60\s*kg)(?![\p{L}])/iu
/** How-it-works / video / demo. */
const HOW_IT_WORKS_STAGE_RE =
  /(?<![\p{L}])(?:c[oó]mo\s+funciona|c[oó]mo\s+se\s+(?:usa|arma|pone)|verlo|video|tutorial|demostraci[oó]n|c[oó]mo\s+vuela)(?![\p{L}])/iu
/** Store asked for shipping / order data. */
const SHIPPING_DETAILS_ASK_RE =
  /(?<![\p{L}])(?:nombre\s+completo|para\s+preparar\s+tu\s+pedido|me\s+pas[aá]s?(?:\s+por\s+favor)?\s*:|direcci[oó]n\s+exacta|provincia|cant[oó]n|distrito)(?![\p{L}])/iu

/** Which v2 text a quiet chat gets, from its messages (any order), or null (the round's own text). */
export function followUpSlot(messages: readonly FollowUpStateMessage[], newestFirst = true): FollowUpSlot | null {
  const ordered = newestFirst ? [...messages].reverse() : [...messages]
  const history: SoftAiHistoryMessage[] = ordered.map((m, i) => ({
    id: String(i),
    direction: m.direction === 'outbound' ? 'outbound' : 'inbound',
    content: m.content || '',
    sentAt: '',
  }))
  if (history.some((m) => m.direction === 'outbound' && paymentDetailsIn(m.content))) {
    if (paidAfterDetails(history, paymentDetailsIn)) return null
    // SecureDog INT-242: every customer bubble after the last details is plain text with nothing about paying (no photo
    // / file — a captioned receipt is stored as its caption — no "listo", part payment, double charge or refund).
    let last = -1
    ordered.forEach((m, i) => {
      if (m.direction === 'outbound' && paymentDetailsIn(m.content || '')) last = i
    })
    const after = ordered.slice(last + 1).filter((m) => m.direction === 'inbound')
    const clean = after.every((m) => {
      const t = m.content || ''
      return (
        (!m.messageType || m.messageType === 'text') &&
        !MEDIA_LIKE_RE.test(t) &&
        !SENT_VERB_RE.test(t) &&
        // INT-241 r2: a later date anywhere after the details ("Mañana le escribo" then "Gracias").
        !(!/[?¿]/u.test(t) && WAITING_DATE_RE.test(t)) &&
        classifyPaymentText(t) === 'non_payment' &&
        !isShortDoneBubble(t)
      )
    })
    return clean ? 'sinpe_reminder' : null
  }
  // Prefer the most recent stage signal (newest outbound / inbound), so a price opener that later asked for size
  // nudges about size — not a generic "¿te quedó alguna duda?" after ₡.
  const lastOut = [...history].reverse().find((m) => m.direction === 'outbound')
  const lastIn = [...history].reverse().find((m) => m.direction === 'inbound')
  if (payPendingAfterData(history)) return 'pay_pending'
  if (lastOut && SHIPPING_DETAILS_ASK_RE.test(lastOut.content)) return 'shipping_details'
  if ((lastIn && SIZE_ASK_RE.test(lastIn.content)) || (lastOut && SIZE_ANSWER_RE.test(lastOut.content))) return 'size'
  if ((lastOut && HOW_IT_WORKS_STAGE_RE.test(lastOut.content)) || (lastIn && HOW_IT_WORKS_STAGE_RE.test(lastIn.content))) {
    return 'how_it_works'
  }
  if (lastIn && !/[?¿]/u.test(lastIn.content) && CHOSE_RE.test(lastIn.content)) return 'chose'
  if (history.some((m) => m.direction === 'outbound' && /₡\s?\d/u.test(m.content))) return 'quoted'
  return null
}

/**
 * The owner's slot texts, kept only when they are plain words: a payment reminder never carries a number, an amount or
 * a link (the details were already sent; a stale or wrong number must never go out unattended).
 */
export function parseStageTexts(raw: unknown): Partial<Record<FollowUpSlot, string>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Partial<Record<FollowUpSlot, string>> = {}
  for (const slot of FOLLOW_UP_SLOTS) {
    const t = (raw as Record<string, unknown>)[slot]
    if (typeof t !== 'string' || !t.trim() || t.length > 400) continue
    // SecureDog INT-243: no digit of any script, currency sign, number word or anything shaped like a link / domain.
    // r2: on the NFKC form (superscripts, circled digits, "․" one-dot leader), any \p{N}, and tens / slang money words.
    const k = t.normalize('NFKC')
    if (
      (slot === 'sinpe_reminder' || slot === 'pay_pending') &&
      (/[\p{N}\p{Sc}]|https?:|www\.|[\p{L}\p{N}-][.․。][\p{L}]{2,}/u.test(k) ||
        /(?<![\p{L}])(?:mil|miles|cien|ciento|cientos|colones|rojos|lucas|teja|tejas|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|veinti\p{L}*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)(?![\p{L}])/iu.test(k))
    )
      continue
    out[slot] = t.trim()
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * pay_pending (oldest first): the store asked for the order data, the customer sent it (bubbles joined), and the store's
 * LAST message asks how to pay — no payment details, no later date. The data request must come before the data.
 */
function payPendingAfterData(history: readonly SoftAiHistoryMessage[]): boolean {
  const lastOutAt = history.map((m) => m.direction).lastIndexOf('outbound')
  if (lastOutAt < 0 || !isPaymentMethodQuestion(history[lastOutAt].content)) return false
  if (history.slice(lastOutAt + 1).some((m) => m.direction === 'inbound')) return false
  const askAt = history.findIndex((m) => m.direction === 'outbound' && SHIPPING_DETAILS_ASK_RE.test(m.content))
  if (askAt < 0 || askAt >= lastOutAt) return false
  const given = history.slice(askAt + 1, lastOutAt).filter((m) => m.direction === 'inbound').map((m) => m.content)
  if (!given.some((t) => customerGaveOrderData(t)) && !customerGaveOrderData(given.join('\n'))) return false
  const newestFirst = [...history].reverse().map((m) => ({ direction: m.direction, content: m.content }))
  return !customerNamedLaterDate(newestFirst)
}
