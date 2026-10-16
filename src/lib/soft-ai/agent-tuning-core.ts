/**
 * Agentes IA 2.0 · E — "Corregir" (live tuning). Pure helpers, client-safe (no Prisma): the owner says how the agent
 * should have answered and code turns it into (a) one more question/answer example in the agent's own corrections
 * document, (b) a saved reply the agent can use, or (c) a "siempre / nunca" line in the selling rules.
 * Deterministic: no AI call to save. Corrections are DATA in the prompt; the fixed rules still win.
 *
 * Review fixes 2026-10-15 (SecureDog INT-103…108, Verifier V1…V11):
 *  - the customer's text is never trusted: sanitizeTuneQuestion (one line, ≤ 200 chars, no markers / tags / links /
 *    personal data) and the owner confirms what the agent will see;
 *  - the owner's own wording is never rewritten: ownerTextProblem refuses (naming the phrase) instead;
 *  - amounts with "¢", "₡3 mil", bare amounts next to price words and amounts in words are checked; payment numbers
 *    use payment-guard's separators (dates are not payment numbers); "nunca …" rules skip the wording checks.
 */
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import { stripBetsyLookalikes } from '@/lib/soft-ai/sales-state'
import { redactPiiText, redactSensitiveForProvider } from '@/lib/soft-ai/llm/redact'
import { DATA_FENCE_TAG_RE, stripFormatChars } from '@/lib/soft-ai/prompt-fence'
import { CR_IBAN_RE, DIGIT_SEP, LONG_NUMBER_RE, PAY_WORDS_RE } from '@/lib/soft-ai/payment-guard'
import { dealProblem, freeShippingRuleOk, type FreeShippingRule } from '@/lib/soft-ai/llm/output-validator'

export const TUNE_SAVE_AS = ['example', 'saved_reply', 'rule'] as const
export type TuneSaveAs = (typeof TUNE_SAVE_AS)[number]

export const TUNE_CUSTOMER_MAX = 500
/** What the agent will see of the customer's question (sanitizeTuneQuestion). */
export const TUNE_QUESTION_MAX = 200
export const TUNE_AGENT_REPLY_MAX = 1500
export const TUNE_CORRECTED_MAX = 1200
export const TUNE_NOTE_MAX = 200
export const TUNE_TITLE_MAX = 60
/** POST body cap (route), checked before JSON parsing. */
export const TUNE_BODY_MAX_BYTES = 16 * 1024
/** Audit keeps a masked copy of the agent's reply, capped (DATA-51). */
export const TUNE_AUDIT_REPLY_MAX = 500
/** Rules lists keep at most this many lines each (parseSalesRules caps at 10 too). */
export const TUNE_RULES_MAX = 10
/**
 * The corrections document has its own prompt budget (KNOWLEDGE_TUNING_CHAR_BUDGET = 2 400, V1): a FAQ source over
 * the budget is dropped whole from the prompt, so the document stays within it and the oldest examples go first.
 */
export const TUNE_EXAMPLES_BODY_MAX = 2_400
/** Older versions of the corrections document keep their text only for this many versions (DATA-51). */
export const TUNE_VERSIONS_WITH_CONTENT = 3
/** Default saved-reply title — never the customer's words (INT-103). */
export const TUNE_DEFAULT_TITLE = 'Respuesta corregida'
/** Shown instead of the form when the reply was sent by code (a saved reply / system message), not the agent. */
export const TUNE_CODE_REPLY_NOTE = 'Esta respuesta la manda una respuesta guardada; editala en Respuestas guardadas.'

export type TuneRefusalCode =
  | 'empty'
  | 'too_long'
  | 'confirmation'
  | 'payment_numbers'
  | 'unknown_amount'
  | 'amount_words'
  | 'deal'
  | 'link'
  | 'marker'
export type TuneCheck = { ok: true } | { ok: false; code: TuneRefusalCode; error: string; amount?: number }

/** Case / accent / punctuation-insensitive key for "the same question". */
export function normalizeQuestion(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

function oneLine(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const DATE_RE = /^\d{1,2}\s?[./\-]\s?\d{1,2}\s?[./\-]\s?(?:\d{2}|\d{4})$/
const MONEY_SIGN_BEFORE_RE = /[₡¢$]\s?$/
const COLONES_AFTER_RE = /^\s*(?:mil\s+)?colones/i
/** Digit runs of 6+ with payment-guard's separators ("8888 - 1234", "8888/1234", "8888–1234", "8888_1234"). */
const SIX_DIGITS_RE = new RegExp(`(?<!\\d)\\d(?:${DIGIT_SEP}\\d){5,}(?!\\d)`, 'gu')

/** TLDs that are links on their own ("bit.ly", "tienda.com"). */
const STRONG_TLDS =
  'com|net|org|cr|ly|io|app|link|info|biz|xyz|site|store|shop|online|gl|ws|club|top|live|gg|lat|tk|ml|ga|cf|click|website|tech|cc|ru|cn|lnk|bio|tienda|social|world|digital|company|dev'
/** TLDs that are also Spanish / English words ("Gracias.De nada"): a link only with a path ("wa.me/506…"). */
const WEAK_TLDS = 'co|me|be|to|us|es|mx|ai|page|tv|la|pe|ar|cl|ec|gt|hn|ni|pa|sv|ve|uy|py|bo|do|in|uk|de|fr|it|eu|fun|pro|one'
const LINK_RE = new RegExp(
  `(?:\\b(?:https?|ftp)://|\\bwww\\.)[^\\s<>"'«»]+|(?<![\\p{L}\\p{N}@.-])(?:[\\p{L}\\p{N}-]+\\.)+(?:(?:${STRONG_TLDS})(?![\\p{L}\\p{N}-])(?:[/?#][^\\s<>"'«»]*)?|(?:${WEAK_TLDS})/[^\\s<>"'«»]*)`,
  'giu',
)

/** Links / bare domains in a text ("https://x.co", "www.x.com", "bit.ly/x9", "wa.me/506…"). */
export function linksIn(text: string): string[] {
  return [...stripFormatChars(text).matchAll(LINK_RE)].map((m) => m[0].replace(/[.,;:!?)\]]+$/, ''))
}

/** Host of a link, lowercased, without "www.". */
export function linkHost(link: string): string {
  return (link || '')
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0]
}

/** The brand's own domains (website / catalog from brand facts), the only links a correction may carry. */
export function brandDomainsFrom(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.map((u) => linkHost(u || '')).filter((h) => h.includes('.')))]
}

function isBrandLink(link: string, brandDomains: string[]): boolean {
  const host = linkHost(link)
  return brandDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

function maskLongDigits(text: string): string {
  return text.replace(SIX_DIGITS_RE, (m, offset: number, whole: string) => {
    if (DATE_RE.test(m.trim())) return m
    // A colón amount ("₡1.250.000") is not personal data.
    if (MONEY_SIGN_BEFORE_RE.test(whole.slice(0, offset))) return m
    return '…'
  })
}

/**
 * The customer's question as the agent will see it (INT-103 b): NFKC, no invisible / control / bidi characters, no
 * Betsy look-alike markers, no links or domains, emails and 6+ digit runs masked, the same PII masking as saved tests
 * (redactPiiText + redactSensitiveForProvider), no < > [ ] { } or backticks, no numbered-rule "16)", one line, ≤ 200.
 */
export function sanitizeTuneQuestion(text: string): string {
  let t = stripFormatChars(text)
  t = stripBetsyLookalikes(t)
  t = t.replace(EMAIL_RE, '…')
  t = t.replace(LINK_RE, ' ')
  t = maskLongDigits(t)
  t = redactSensitiveForProvider(redactPiiText(t))
  t = t.replace(DATA_FENCE_TAG_RE, ' ')
  t = t.replace(/[<>[\]{}`]/g, ' ')
  t = t.replace(/(?<!\d)\(?\d{1,2}\)/g, ' ')
  t = oneLine(t)
  return t.length > TUNE_QUESTION_MAX ? t.slice(0, TUNE_QUESTION_MAX).trim() : t
}

/** Kept for callers of the first version: same as sanitizeTuneQuestion. */
export function maskCustomerMessage(text: string): string {
  return sanitizeTuneQuestion(text)
}

const firstWords = (text: string) => (text.match(/^\S+(?:\s+\S+){0,3}/)?.[0] ?? text).slice(0, 40)

/**
 * The owner's own text (answer, note, title) is never rewritten (V9): invisible characters go, and anything that could
 * pose as Betsy or the prompt (markers, tags, numbered rules, [[…]] tags other than [[DATOS_PAGO]], links that are not
 * the business's own site) is refused with the phrase named. Returns the cleaned text or the Spanish refusal.
 */
export function ownerTextProblem(
  text: string,
  field: string,
  brandDomains: string[] = [],
): { ok: true; text: string } | { ok: false; code: TuneRefusalCode; error: string } {
  const clean = stripFormatChars(text).trim()
  const numbered = clean.match(/(?:^|\n)[ \t]*(\(?\d{1,2}\))/)
  if (numbered) {
    return { ok: false, code: 'marker', error: `${field} tiene una línea numerada como «${numbered[1]}», igual que las reglas internas. Usá guiones en vez de números con paréntesis.` }
  }
  const tag = clean.match(/<\s*\/?\s*[\p{L}_]|KNOWLEDGE[\s_-]*DATA/iu)
  if (tag) {
    const at = tag.index ?? 0
    return { ok: false, code: 'marker', error: `${field} tiene «${firstWords(clean.slice(at))}». No uses etiquetas con < >.` }
  }
  const bracket = [...clean.matchAll(/\[\[[^\]]*\]\]?/g)].find((m) => !/^\[\[\s*DATOS[\s_-]?PAGO\s*\]\]$/i.test(m[0]))
  if (bracket) {
    return { ok: false, code: 'marker', error: `${field} tiene «${bracket[0].slice(0, 40)}». La única marca permitida es [[DATOS_PAGO]].` }
  }
  const stripped = stripBetsyLookalikes(clean)
  if (stripped !== clean) {
    let i = 0
    while (i < clean.length && clean[i] === stripped[i]) i += 1
    return {
      ok: false,
      code: 'marker',
      error: `${field} tiene «${firstWords(clean.slice(i))}», que parece un texto interno del sistema. Escribilo con otras palabras.`,
    }
  }
  const link = linksIn(clean).find((l) => !isBrandLink(l, brandDomains))
  if (link) {
    const own = brandDomains.length ? ` Solo se permite el sitio de tu negocio (${brandDomains.join(', ')}).` : ' Solo se permite el sitio de tu negocio (configuralo en los datos del negocio).'
    return { ok: false, code: 'link', error: `${field} tiene un enlace («${link.slice(0, 40)}»).${own}` }
  }
  return { ok: true, text: clean }
}

/** Reply text keeps its line breaks but never a blank line or a line that could pose as a new "P:" / "R:" entry. */
function answerBlock(text: string): string {
  return (text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^(P|R|Nota)\s*:/i.test(line) ? `- ${line}` : line))
    .join('\n')
}

export type CorrectionPair = { question: string; answer: string }

/** Pairs are blocks "P: …\nR: …" separated by a blank line (the format this module writes). */
export function parseCorrectionPairs(body: string): CorrectionPair[] {
  const out: CorrectionPair[] = []
  for (const block of (body || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const m = block.trim().match(/^P:\s*([^\n]*)\nR:\s*([\s\S]*)$/)
    if (m && m[1].trim() && m[2].trim()) out.push({ question: m[1].trim(), answer: m[2].trim() })
  }
  return out
}

export function formatCorrectionPairs(pairs: CorrectionPair[]): string {
  return pairs.map((p) => `P: ${p.question}\nR: ${p.answer}`).join('\n\n')
}

/** One example: the corrected answer, plus the owner's short note when given. */
export function correctionAnswer(correctedReply: string, note?: string | null): string {
  const answer = answerBlock(correctedReply)
  const n = oneLine(note || '')
  return n ? `${answer}\n(Nota del negocio: ${n})` : answer
}

/**
 * Add (or replace) the example for this question, newest last; drop the oldest until the document fits `max`.
 * The new example itself is always kept (callers bound its size).
 */
export function upsertCorrectionPair(body: string, pair: CorrectionPair, max = TUNE_EXAMPLES_BODY_MAX): string {
  const key = normalizeQuestion(pair.question)
  const next: CorrectionPair = { question: oneLine(pair.question), answer: answerBlock(pair.answer) }
  const pairs = parseCorrectionPairs(body).filter((p) => normalizeQuestion(p.question) !== key)
  pairs.push(next)
  while (pairs.length > 1 && formatCorrectionPairs(pairs).length > max) pairs.shift()
  return formatCorrectionPairs(pairs)
}

const NEVER_LEAD_RE = /^\s*(nunca|jam[aá]s|no|evit[aáe]\w*)(?![\p{L}\p{N}_])/iu
const RULE_LEAD_RE = /^(siempre|nunca|jam[aá]s|no|evit[aáe]\w*)(?![\p{L}\p{N}_])[\s,:]*/iu

/** Where a note goes: "nunca …", "no …", "jamás …", "evitá …" → neverSay; anything else ("siempre …") → mustSay. */
export function ruleTarget(note: string): 'neverSay' | 'mustSay' {
  return NEVER_LEAD_RE.test(note || '') ? 'neverSay' : 'mustSay'
}

/** The prompt already says "Siempre:" / "Nunca:", so the leading word goes ("evitá hablar de X" → "hablar de X"). */
export function ruleText(note: string): string {
  const t = oneLine(note).replace(RULE_LEAD_RE, '').trim()
  return t ? t.slice(0, TUNE_NOTE_MAX) : ''
}

/** The exact line the panel shows before saving (INT-106): "Nunca: prometas bajar de peso". */
export function ruleLine(note: string): string {
  const text = ruleText(note)
  if (!text) return ''
  return `${ruleTarget(note) === 'neverSay' ? 'Nunca' : 'Siempre'}: ${text}`
}

/** Add a rule line (no duplicates), newest last, at most TUNE_RULES_MAX per list (oldest dropped). */
export function placeRule(
  rules: { mustSay: string[]; neverSay: string[] },
  note: string,
): { mustSay: string[]; neverSay: string[]; target: 'neverSay' | 'mustSay'; text: string } {
  const target = ruleTarget(note)
  const text = ruleText(note)
  const lists = { mustSay: [...rules.mustSay], neverSay: [...rules.neverSay] }
  if (text) {
    const key = normalizeQuestion(text)
    const list = lists[target].filter((x) => normalizeQuestion(x) !== key)
    list.push(text)
    lists[target] = list.slice(-TUNE_RULES_MAX)
  }
  return { ...lists, target, text }
}

const DIGIT_WORD = '(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)'
/** "ocho ocho ocho ocho …": a number spelled digit by digit (4+ digit words in a row). */
const DIGIT_WORDS_RE = new RegExp(`(?<![\\p{L}])${DIGIT_WORD}(?:[\\s,.\\-y]+${DIGIT_WORD}){3,}(?![\\p{L}])`, 'iu')

/** Payment data never goes in a correction: only [[DATOS_PAGO]] (Betsy fills the numbers). */
export function hasPaymentNumbers(text: string): boolean {
  const t = stripFormatChars(text)
  if (/\bCR\s?\d{2}(?:[\s-]?\d{4}){4}[\s-]?\d{2}\b/i.test(t)) return true
  if (new RegExp(CR_IBAN_RE.source, 'iu').test(t)) return true
  for (const m of t.matchAll(new RegExp(LONG_NUMBER_RE.source, 'gu'))) {
    const at = m.index ?? 0
    // A big colón amount ("₡12.500.000", "12.500.000 colones") is an amount, not an account.
    if (MONEY_SIGN_BEFORE_RE.test(t.slice(0, at)) || COLONES_AFTER_RE.test(t.slice(at + m[0].length))) continue
    // A date ("10.10.2026", "10/10/2026") is not a payment number (V7).
    if (DATE_RE.test(m[0].trim())) continue
    return true
  }
  // Spelled out next to payment words ("SINPE al ocho ocho ocho ocho…", INT-105).
  if (PAY_WORDS_RE.test(t) && DIGIT_WORDS_RE.test(t)) return true
  return false
}

/** Colón amounts written in the text ("₡14.900", "¢5.000", "₡ 5000", "₡3 mil", "14 900 colones"). */
export function colonAmountsIn(text: string): number[] {
  const out: number[] = []
  const re = /[₡¢]\s?(\d{1,3}(?:[.,\s]\d{3})+|\d+)(\s*mil(?![\p{L}]))?|(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3})+|\d+)(\s*mil)?\s*colones/giu
  for (const m of stripFormatChars(text).matchAll(re)) {
    const digits = (m[1] || m[3] || '').replace(/\D/g, '')
    const thousand = Boolean(m[2] || m[4])
    const n = Number(digits) * (thousand ? 1000 : 1)
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}

/** Bare amounts next to a price word ("cuesta 12000", "el combo queda en 17.900", INT-104). */
const PRICE_WORD_AMOUNT_RE =
  /(?<![\p{L}])(?:cuestan?|precios?|salen?|quedan?|valen?|total|env[ií]os?|combos?|pag(?:a|ás|as|an|ar))(?![\p{L}])[^\p{L}\p{N}]{0,3}(?:\p{L}+[^\p{L}\p{N}]{1,3}){0,3}?(?<![\d.,/])(\d{1,3}(?:[.,\s]\d{3})+|\d{4,7})(?![\d]|[.,/]\d)/giu

export function priceWordAmountsIn(text: string): number[] {
  return [...stripFormatChars(text).matchAll(PRICE_WORD_AMOUNT_RE)].map((m) => Number(m[1].replace(/\D/g, ''))).filter((n) => n > 0)
}

const NUM_WORD =
  '(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\\p{L}+|veinti?\\p{L}*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos)'
/**
 * Amounts in words ("doce mil", "mil colones", "quince mil quinientos"). Narrower than promo.ts headlineHasNumberWords
 * on purpose: a reply often says "uno o dos" — only number words that make a money amount are refused.
 */
const AMOUNT_WORDS_RE = new RegExp(`(?<![\\p{L}])(?:${NUM_WORD}\\s+(?:mil|colones|rojos|tejas)|mil\\s+(?:colones|${NUM_WORD}))(?![\\p{L}])`, 'iu')

export function hasAmountInWords(text: string): string | null {
  return stripFormatChars(text).match(AMOUNT_WORDS_RE)?.[0] ?? null
}

const fmt = (n: number) => `₡${n.toLocaleString('es-CR')}`

export type CorrectionCheckOptions = {
  /** A "nunca …" rule names what NOT to say: wording, amount and deal checks don't apply to it (V7). */
  neverRule?: boolean
  /** Deals the owner's active promo enables (promoAllowedDeals). */
  allowedDeals?: ReadonlyArray<'free_shipping' | 'special_price'>
  /** Combos the owner marked as including shipping (output-validator FreeShippingRule). */
  freeShippingRule?: FreeShippingRule | null
}

/** Deal wording the live validator would also block (promo-aware, INT-105 / INT-77). */
export function correctionDealProblem(text: string, allowed: ReadonlyArray<'free_shipping' | 'special_price'>, rule?: FreeShippingRule | null): boolean {
  if (!dealProblem(text, allowed)) return false
  if (!rule || allowed.includes('free_shipping')) return true
  return dealProblem(text, [...allowed, 'free_shipping']) || !freeShippingRuleOk(text, rule)
}

/** Refusals in plain Spanish (shown as-is in the panel). `allowedAmounts` = the agent's own prices. */
export function checkCorrectionText(text: string, allowedAmounts: number[], field = 'La respuesta', opts: CorrectionCheckOptions = {}): TuneCheck {
  const never = opts.neverRule === true
  if (!never && hasConfirmationWording(text)) {
    return {
      ok: false,
      code: 'confirmation',
      error: `${field} dice que un pago o pedido está confirmado. El agente nunca confirma pagos ni pedidos: eso lo hace una persona. Escribilo sin esa frase.`,
    }
  }
  if (hasPaymentNumbers(text)) {
    return {
      ok: false,
      code: 'payment_numbers',
      error: `${field} tiene un número de cuenta, SINPE o teléfono (8 dígitos o más, también escrito en palabras). Los datos de pago los pone Betsy: escribí [[DATOS_PAGO]] donde van.`,
    }
  }
  if (never) return { ok: true }
  const allowed = new Set(allowedAmounts.map((n) => Math.round(n)))
  const unknown = [...colonAmountsIn(text), ...priceWordAmountsIn(text)].find((n) => !allowed.has(n))
  if (unknown !== undefined) {
    return {
      ok: false,
      code: 'unknown_amount',
      amount: unknown,
      error: `${field} dice ${fmt(unknown)}, y ese monto no es un precio de este agente (productos, envíos o combos). Corregí el monto o actualizá los precios primero.`,
    }
  }
  const words = hasAmountInWords(text)
  if (words) {
    return {
      ok: false,
      code: 'amount_words',
      error: `${field} dice «${words}» en palabras. Escribí los montos con números (por ejemplo ₡12.900) para que Betsy pueda revisarlos.`,
    }
  }
  if (correctionDealProblem(text, opts.allowedDeals ?? [], opts.freeShippingRule)) {
    return {
      ok: false,
      code: 'deal',
      error: `${field} ofrece un descuento, regalo o envío gratis que no está activo en tus promociones. Activá la promoción primero o escribilo sin esa oferta.`,
    }
  }
  return { ok: true }
}

function randomSuffix(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : ''
  const hex = uuid.replace(/[^a-f0-9]/g, '')
  return (hex || Math.random().toString(36).replace(/[^a-z0-9]/g, '')).slice(0, 4).padEnd(4, '0')
}

/**
 * Shortcut key for a saved reply: fix_<slug of the TITLE>_<4 random chars>, unique among `taken`
 * (validateShortcutForSave: ^[a-z0-9_]{2,40}$). Never built from the customer's text (INT-103 c).
 */
export function savedReplyKey(title: string, taken: Set<string>, suffix: string = randomSuffix()): string {
  const slug = normalizeQuestion(title).replace(/ñ/g, 'n').split(' ').filter(Boolean).slice(0, 4).join('_').slice(0, 24).replace(/_+$/, '')
  const tail = (suffix || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || '0000'
  const base = `fix_${slug || 'respuesta'}_${tail}`.slice(0, 40)
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const k = `${base.slice(0, 36)}_${i}`
    if (!taken.has(k)) return k
  }
  return `fix_${Date.now().toString(36)}`.slice(0, 40)
}

/** Title for a saved reply: the owner's, else "Respuesta corregida" (never the customer's words). */
export function savedReplyTitle(title: string | null | undefined): string {
  const own = oneLine(title || '')
  return own ? own.slice(0, TUNE_TITLE_MAX) : TUNE_DEFAULT_TITLE
}

/**
 * Real chats: "Corregir" only on an AI message with its OWN recorded agent (metadata.agentId, INT-108) and a way to
 * find the customer message it answered (metadata.answersMessageId, or the turn for older messages, V6). A reply sent
 * by code (metadata.replyBy = 'code', V11) shows the "Respuestas guardadas" note instead.
 */
export function tuneTargetFromMetadata(metadata: unknown): { agentId: string; agentName: string | null; codeReply: boolean } | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const m = metadata as Record<string, unknown>
  if (m.softAi !== true || typeof m.agentId !== 'string' || !m.agentId.trim()) return null
  const answerable = (typeof m.answersMessageId === 'string' && m.answersMessageId.length > 0) || (typeof m.turnId === 'string' && m.turnId.length > 0)
  if (!answerable) return null
  return {
    agentId: m.agentId,
    agentName: typeof m.agentName === 'string' && m.agentName.trim() ? m.agentName.trim() : null,
    codeReply: m.replyBy === 'code',
  }
}

export type TuneBody = {
  customerMessage: string
  agentReply: string | null
  correctedReply: string
  note: string | null
  saveAs: TuneSaveAs
  title: string | null
  /** Real chats: the AI message being corrected (the server loads both texts itself, INT-107). */
  messageId: string | null
}

/** Shape + size checks of the POST body (Spanish errors). */
export function parseTuneBody(raw: unknown): { ok: true; value: TuneBody } | { ok: false; error: string } {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!r) return { ok: false, error: 'Faltan los datos de la corrección.' }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const customerMessage = str(r.customerMessage)
  const agentReply = str(r.agentReply)
  const correctedReply = str(r.correctedReply)
  const note = str(r.note)
  const title = str(r.title)
  const messageId = str(r.messageId)
  const saveAs = r.saveAs === undefined || r.saveAs === null || r.saveAs === '' ? 'example' : r.saveAs
  if (!(TUNE_SAVE_AS as readonly unknown[]).includes(saveAs)) return { ok: false, error: 'Elegí cómo guardar la corrección.' }
  if (messageId && !/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) return { ok: false, error: 'Mensaje inválido.' }
  if (!customerMessage && !messageId) return { ok: false, error: 'Falta el mensaje del cliente.' }
  if (customerMessage.length > TUNE_CUSTOMER_MAX) return { ok: false, error: `El mensaje del cliente supera ${TUNE_CUSTOMER_MAX} caracteres.` }
  if (agentReply.length > TUNE_AGENT_REPLY_MAX) return { ok: false, error: `La respuesta del agente supera ${TUNE_AGENT_REPLY_MAX} caracteres.` }
  if (note.length > TUNE_NOTE_MAX) return { ok: false, error: `La nota supera ${TUNE_NOTE_MAX} caracteres.` }
  if (title.length > TUNE_TITLE_MAX) return { ok: false, error: `El título supera ${TUNE_TITLE_MAX} caracteres.` }
  if (correctedReply.length > TUNE_CORRECTED_MAX) return { ok: false, error: `La respuesta corregida supera ${TUNE_CORRECTED_MAX} caracteres.` }
  if (saveAs === 'rule') {
    if (!note) return { ok: false, error: 'Para guardar una regla, escribila en "Nota" (por ejemplo: "nunca prometas bajar de peso").' }
  } else if (!correctedReply) {
    return { ok: false, error: 'Escribí cómo debería responder.' }
  }
  return {
    ok: true,
    value: {
      customerMessage,
      agentReply: agentReply || null,
      correctedReply,
      note: note || null,
      saveAs: saveAs as TuneSaveAs,
      title: title || null,
      messageId: messageId || null,
    },
  }
}
