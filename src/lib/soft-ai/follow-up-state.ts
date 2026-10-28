/**
 * Follow-ups v2 (Rafael 2026-10-28, DeepSleep 7-day review): pure checks on the chat's last messages that make a
 * follow-up a wrong send, whatever its text. Seen live: "¿Te quedó alguna duda?" after the customer had sent size +
 * address or got the SINPE details, after "espero la quincena" / "ahorita no tengo plata", after "mañana le escribo".
 * No DB, no server-only: follow-up.ts reads the messages and calls this.
 */
import { paymentDetailsIn } from '@/lib/soft-ai/sales-state'

export type FollowUpStateMessage = { direction: string; content?: string | null }
export type FollowUpStateSkip = 'payment_details_sent' | 'data_given' | 'waiting_date'

/** Order data labels the customer fills in ("Nombre: …", "Provincia: …") or address words. */
const DATA_LABEL_RE =
  /(?<![\p{L}])(?:nombre(?:\s+completo)?|tel[eé]fono|celular|provincia|cant[oó]n|distrito|direcci[oó]n|se[nñ]as|c[eé]dula|correo)\s*[:\-–]/iu
const ADDRESS_WORD_RE =
  /(?<![\p{L}])(?:provincia|cant[oó]n|distrito|barrio|residencial|condominio|apartamento|casa\s+(?:n[uú]mero|#|color)|\d+\s*(?:metros|mts?|m)\.?\s+(?:al\s+)?(?:norte|sur|este|oeste)|(?:del|de\s+la)\s+(?:iglesia|escuela|pulper[ií]a|plaza|parque|super|rotonda)\p{L}*)(?![\p{L}])/iu
/** A Costa Rica phone: 8 digits, optional +506 and one separator. */
const CR_PHONE_RE = /(?<!\d)(?:\+?506[\s-]?)?[2-8]\d{3}[\s.-]?\d{4}(?!\d)/u
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/iu

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
    'no\\s+me\\s+alcanza',
    '(?:la\\s+)?(?:otra|pr[oó]xima)\\s+semana',
    'aguinaldo',
    // "Mañana le escribo", "El lunes les aviso", "Luego te confirmo": a promise to come back.
    '(?:ma[nñ]ana|luego|despu[eé]s|el\\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))\\s+(?:(?:yo\\s+)?(?:le|te|les)\\s+)?(?:escribo|aviso|confirmo|hablo|contacto|pido|compro|encargo|digo)',
    '(?:le|te|les)\\s+(?:escribo|aviso|confirmo)\\s+(?:ma[nñ]ana|luego|despu[eé]s|el\\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|la\\s+otra\\s+semana)',
  ].map((p) => `(?<![\\p{L}])${p}(?![\\p{L}])`).join('|'),
  'iu',
)

/** The customer sent order data: labelled fields, an email, or a phone next to an address. */
export function customerGaveOrderData(text: string): boolean {
  const t = text || ''
  if (DATA_LABEL_RE.test(t) || EMAIL_RE.test(t)) return true
  return CR_PHONE_RE.test(t) && (ADDRESS_WORD_RE.test(t) || t.split(/\n|,|\//u).length >= 3)
}

/**
 * Why this chat must not get a follow-up from its messages (newest first or oldest first, any order), or null.
 * Only the customer's LAST message decides a named date (an old "mañana le escribo" followed by new questions is fine).
 */
export function followUpStateSkip(messages: readonly FollowUpStateMessage[], newestFirst = true): FollowUpStateSkip | null {
  const ordered = newestFirst ? messages : [...messages].reverse()
  if (ordered.some((m) => m.direction === 'outbound' && paymentDetailsIn(m.content || ''))) return 'payment_details_sent'
  if (ordered.some((m) => m.direction === 'inbound' && customerGaveOrderData(m.content || ''))) return 'data_given'
  const lastIn = ordered.find((m) => m.direction === 'inbound')
  if (lastIn && WAITING_DATE_RE.test(lastIn.content || '')) return 'waiting_date'
  return null
}
