/**
 * luna-10 #5 (2026-10-16, live PatchHouse): the customer saw the product list twice and the same Stress Down line three
 * times — consecutive turns (rapid customer messages) each repeated what the chat had just shown. Before a reply goes
 * out, any message of it that (nearly) repeats a message the chat got in the last 20 minutes is dropped. When every
 * message would be dropped, the caller sends the safe line instead (a person looks) — never the same text again.
 * Exception: the customer asks for it again ("de nuevo", "no me llegó"…). Pure.
 */
import { splitReplyParts } from '@/lib/soft-ai/reply-parts'
import { PICKUP_DATA_LIST, SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'

export const REPEAT_WINDOW_MS = 20 * 60_000
/** Shorter messages ("¡Perfecto!", "Con gusto 😊") may repeat naturally. */
const MIN_REPEAT_CHARS = 15
const JACCARD_MIN = 0.8
const MIN_WORDS_FOR_JACCARD = 4
/** Paraphrase rule: most of this message's content words (4+ letters) were already said in one earlier message. */
const CONTENT_SHARE_MIN = 0.8
const MIN_CONTENT_WORDS = 5

export function normalizeForRepeat(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(n: string): Set<string> {
  return new Set(n.split(' ').filter((w) => w.length > 1))
}

function contentWords(n: string): Set<string> {
  return new Set(n.split(' ').filter((w) => w.length > 3))
}

const ASK_STOPWORDS = new Set(['que', 'qué', 'los', 'las', 'del', 'por', 'con', 'una', 'uno', 'hay', 'mas', 'cuanto', 'cuánto', 'sale', 'cuesta', 'precio', 'envio', 'para', 'como', 'tienen', 'tiene', 'quiero', 'hola', 'gracias', 'favor', 'pero', 'esta', 'este', 'eso', 'son'])
function askedWords(customerText: string | null | undefined): Set<string> {
  return new Set(normalizeForRepeat(customerText || '').split(' ').filter((w) => w.length >= 3 && !ASK_STOPWORDS.has(w)))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter += 1
  return inter / (a.size + b.size - inter)
}

/**
 * Customers ask for these again on purpose (missing fields, "¿a qué número?"): the fixed data list and payment details
 * (phone / account numbers, IBAN) may always repeat.
 */
export function mayAlwaysRepeat(part: string): boolean {
  const t = part || ''
  return t.includes(SHIPPING_DATA_LIST) || t.includes(PICKUP_DATA_LIST) || /\d{4}[\s-]?\d{4}/.test(t) || /\bCR\d{2}/i.test(t)
}

/** Numbers in a text (prices, days, quantities): "₡2.500" and "₡3.500" are different answers. */
function numbersIn(text: string): string {
  return [...(text || '').matchAll(/\d[\d.,\s]*\d|\d/g)].map((m) => m[0].replace(/[^\d]/g, '')).sort().join('|')
}

/** True when `part` says (nearly) the same as one of the earlier messages. */
export function isNearRepeat(part: string, previous: string[], customerText?: string | null): boolean {
  const n = normalizeForRepeat(part)
  if (n.length < MIN_REPEAT_CHARS) return false
  const nw = words(n)
  const nNumbers = numbersIn(part)
  // Verifier rounds 2–3: words the customer wrote since the agent last answered (a place, a product), 3+ letters.
  const asked = askedWords(customerText)
  for (const prevMessage of previous) {
    for (const prevPart of splitReplyParts(prevMessage, 50)) {
      const p = normalizeForRepeat(prevPart)
      if (!p) continue
      // Verifier F2: a different price / day / amount is a new answer, never a repeat.
      if (numbersIn(prevPart) !== nNumbers) continue
      if (p === n) return true
      if (n.length >= 25 && p.includes(n)) return true
      // "El envío a Limón…" after "El envío a San José…" when the customer asked about Limón: a new answer.
      const pw0 = words(p)
      if ([...words(n)].some((w) => asked.has(w) && !pw0.has(w))) continue
      const pw = words(p)
      if (nw.size >= MIN_WORDS_FOR_JACCARD && pw.size >= MIN_WORDS_FOR_JACCARD && jaccard(nw, pw) >= JACCARD_MIN) return true
      const nc = contentWords(n)
      const pc = contentWords(p)
      // Paraphrase only between messages of similar size (a long list "contains" every product name).
      const similarSize = pc.size > 0 && nc.size / pc.size >= 0.6 && nc.size / pc.size <= 1.6
      if (nc.size >= MIN_CONTENT_WORDS && similarSize) {
        let shared = 0
        for (const w of nc) if (pc.has(w)) shared += 1
        if (shared / nc.size >= CONTENT_SHARE_MIN) return true
      }
    }
  }
  return false
}

const ASKS_AGAIN_RE =
  /\b(?:de\s+nuevo|otra\s+vez|nuevamente|no\s+me\s+(?:lleg[oó]|sali[oó]|apareci[oó]|carg[oó])|repet[ií]|reenvi|volv[eé]\s+a\s+(?:mandar|enviar|pasar))/iu

export function customerAsksAgain(customerText: string | null | undefined): boolean {
  return ASKS_AGAIN_RE.test(normalizeForRepeat(customerText || '').replace(/\s+/g, ' ') + ' ') || ASKS_AGAIN_RE.test(customerText || '')
}

/** Splits the reply into its messages and drops the ones the chat already got (order kept). */
export function dropRepeatedParts(input: { text: string; previous: string[]; customerText?: string | null }): { kept: string[]; dropped: string[] } {
  const parts = splitReplyParts(input.text, 50)
  if (!input.previous.length || customerAsksAgain(input.customerText)) return { kept: parts, dropped: [] }
  const kept: string[] = []
  const dropped: string[] = []
  for (const part of parts) {
    // A message repeating an earlier message of this same reply is dropped too.
    if (!mayAlwaysRepeat(part) && (isNearRepeat(part, input.previous, input.customerText) || isNearRepeat(part, kept))) dropped.push(part)
    else kept.push(part)
  }
  return { kept, dropped }
}
