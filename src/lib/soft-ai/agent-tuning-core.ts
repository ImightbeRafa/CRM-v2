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
import { bareMilAmounts, dealProblem, freeShippingRuleOk, hasThousandsSeparator, type FreeShippingRule } from '@/lib/soft-ai/llm/output-validator'
import { foreignLinks, linkRegex, type LinkAllowlist } from '@/lib/soft-ai/links'

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

// INT-109: one generic link pattern (links.ts), shared with the live reply checker.
export { brandDomainsFrom, buildLinkAllowlist, linkHost, linksIn, type LinkAllowlist } from '@/lib/soft-ai/links'

/**
 * Save-time normalizer: NFKC, no invisible characters, and Arabic-Indic / Extended Arabic-Indic digits (U+0660–0669,
 * U+06F0–06F9, which NFKC does not fold) as ASCII digits — "٨٨٨٨٨٨٨٨" is a payment number too (INT-105).
 */
export function tuneText(text: string): string {
  return stripFormatChars(text).replace(/[\u{660}-\u{669}\u{6F0}-\u{6F9}]/gu, (d) => {
    const c = d.codePointAt(0) ?? 0
    return String(c >= 0x6f0 ? c - 0x6f0 : c - 0x660)
  })
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
  let t = tuneText(text)
  t = stripBetsyLookalikes(t)
  t = t.replace(EMAIL_RE, '…')
  t = t.replace(linkRegex(), ' ')
  t = maskLongDigits(t)
  // A phone written "8888,1234" (comma is not a general digit separator any more, INT-113).
  t = t.replace(/(?<![\d,])\d{4},\d{4}(?![\d,])/g, '…')
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

/** Betsy's own line forms (BETSY_DATOS block / fixed rules) at the start of a line or sentence (N9). */
const BETSY_LINE_RE =
  /(?:^|\n|[.!?]\s+)[ \t]*((?:promoci[oó]n\s+activa|siguiente\s+paso|etapa|estado\s+de\s+la\s+venta|reglas?\s+fijas?)\s*:)/iu

/**
 * The owner's own text (answer, note, title) is never rewritten with markers (V9): invisible characters go, and only
 * what could really pose as Betsy or the prompt is refused, naming the phrase (N9): Betsy's own line forms at the
 * start of a line ("Promoción activa:", "Siguiente paso:", "Etapa:", "Estado de la venta:", "Reglas fijas:"), the
 * BETSY_DATOS marker, fence / HTML tags, [[…]] other than [[DATOS_PAGO]], links that are not the business's own site,
 * and — in a RULE only — a numbered "16)" line. In an answer a numbered list just becomes "1." "2." (kept readable).
 */
export function ownerTextProblem(
  text: string,
  field: string,
  /** INT-112: the same allowlist the live checker uses (or a plain list of the brand's own hosts). */
  allowedLinks: LinkAllowlist | string[] = [],
  kind: 'answer' | 'rule' = 'answer',
): { ok: true; text: string } | { ok: false; code: TuneRefusalCode; error: string } {
  let clean = tuneText(text).trim()
  const numbered = clean.match(/(?:^|\n)[ \t]*(\(?\d{1,2}\))/)
  if (numbered && kind === 'rule') {
    return { ok: false, code: 'marker', error: `${field} empieza con «${numbered[1]}», igual que las reglas internas. Escribila sin el número.` }
  }
  clean = clean.replace(/(^|\n)([ \t]*)\(?(\d{1,2})\)/g, '$1$2$3.')
  const tag = clean.match(/<\s*\/?\s*[\p{L}_]|KNOWLEDGE[\s_-]*DATA/iu)
  if (tag) {
    const at = tag.index ?? 0
    return { ok: false, code: 'marker', error: `${field} tiene «${firstWords(clean.slice(at))}». No uses etiquetas con < >.` }
  }
  const bracket = [...clean.matchAll(/\[\[[^\]]*\]\]?/g)].find((m) => !/^\[\[\s*DATOS[\s_-]?PAGO\s*\]\]$/i.test(m[0]))
  if (bracket) {
    return { ok: false, code: 'marker', error: `${field} tiene «${bracket[0].slice(0, 40)}». La única marca permitida es [[DATOS_PAGO]].` }
  }
  const marker = clean.match(/BETSY[\s_.-]*DATOS/i)?.[0] ?? clean.match(BETSY_LINE_RE)?.[1]
  if (marker) {
    return {
      ok: false,
      code: 'marker',
      error: `${field} tiene «${marker.slice(0, 40)}», que parece un texto interno del sistema. Escribilo con otras palabras.`,
    }
  }
  const link = foreignLinks(clean, allowedLinks)[0]
  if (link) {
    const shown = Array.isArray(allowedLinks) ? allowedLinks : [...(allowedLinks as LinkAllowlist).hosts, ...(allowedLinks as LinkAllowlist).prefixes]
    const own = shown.length
      ? ` Solo se permiten los enlaces de tu negocio (${shown.slice(0, 4).join(', ')}).`
      : ' Solo se permite el sitio de tu negocio (configuralo en los datos del negocio).'
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

/** "no" + a verb that forbids saying / doing something ("no digas", "no le prometas", INT-111). */
const NO_PROHIBIT_RE =
  /^\s*no\s+(?:(?:le|les|te|lo|la|los|las|se|me|nos)\s+)?(?:digas|prometas|ofrezcas|confirmes|menciones|des|uses|hables|inventes|compartas|mandes|env[ií]es|cobres|pidas|respondas|pongas)(?![\p{L}\p{N}_])/iu
/** "No te olvides de …" / "no olvides …" / "no dejes de …": a reminder, i.e. "Siempre" (INT-111). */
const NO_FORGET_LEAD_RE = /^\s*no\s+(?:te\s+olvides\s+de|olvides(?:\s+de)?|dejes\s+de)(?![\p{L}\p{N}_])[\s,:]*/iu
const NEVER_WORD_RE = /^\s*(?:nunca|jam[aá]s|evit[aáe]\p{L}*)(?![\p{L}\p{N}_])/iu
const LEAD_WORD_RE = /^\s*(?:siempre|nunca|jam[aá]s|evit[aáe]\p{L}*)(?![\p{L}\p{N}_])[\s,:]*/iu

/**
 * Where a note goes (INT-111): "nunca …", "jamás …", "evitá / evitar …" and "no" + a forbidding verb ("no digas",
 * "no prometas", …) → neverSay. Anything else — "siempre …", "no te olvides de …", "no hay envíos los domingos" —
 * → mustSay, and gets every check.
 */
export function ruleTarget(note: string): 'neverSay' | 'mustSay' {
  const t = note || ''
  if (NO_FORGET_LEAD_RE.test(t)) return 'mustSay'
  return NEVER_WORD_RE.test(t) || NO_PROHIBIT_RE.test(t) ? 'neverSay' : 'mustSay'
}

/**
 * The prompt already says "Siempre:" / "Nunca:", so the leading word goes ("evitá hablar de X" → "hablar de X",
 * "no digas X" → "digas X", "no te olvides de ofrecer el 2x1" → "ofrecer el 2x1"). Any other "no …" stays as written.
 */
export function ruleText(note: string): string {
  const one = oneLine(note)
  let t: string
  if (NO_FORGET_LEAD_RE.test(one)) t = one.replace(NO_FORGET_LEAD_RE, '')
  else if (NO_PROHIBIT_RE.test(one)) t = one.replace(/^\s*no\s+/i, '')
  else t = one.replace(LEAD_WORD_RE, '')
  t = t.trim()
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
  const t = tuneText(text)
  if (/\bCR\s?\d{2}(?:[\s-]?\d{4}){4}[\s-]?\d{2}\b/i.test(t)) return true
  if (new RegExp(CR_IBAN_RE.source, 'iu').test(t)) return true
  // payment-guard's separators: "8888-1234", "8888 -- 1234", "8888,1234", "8888_1234", "8888/1234" (INT-105).
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

/** Words after "N mil" that make it a count, not money ("2 mil años", "5 mil seguidores"). */
const NOT_MONEY_AFTER = '(?!\\s+(?:años|personas|seguidores|clientes|unidades|pedidos|ventas))'

/** Colón amounts written in the text ("₡14.900", "¢5.000", "₡ 5000", "₡3 mil", "15 mil", "15mil", "14 900 colones"). */
export function colonAmountsIn(text: string): number[] {
  const out: number[] = []
  const re = new RegExp(
    [
      `[₡¢]\\s?(\\d{1,3}(?:[.,\\s]\\d{3})+|\\d+)(\\s*mil(?![\\p{L}]))?`,
      `(?<![\\d.,])(\\d{1,3}(?:[.,\\s]\\d{3})+|\\d+)(\\s*mil)?\\s*colones`,
    ].join('|'),
    'giu',
  )
  const t = tuneText(text)
  for (const m of t.matchAll(re)) {
    const spaced = m[1] || m[3] || ''
    const digits = spaced.replace(/\D/g, '')
    // R4: "₡9.900 mil gracias" is ₡9.900 — a number with a thousands separator is never multiplied.
    const thousand = Boolean(m[2] || m[4]) && !hasThousandsSeparator(spaced)
    const n = Number(digits) * (thousand ? 1000 : 1)
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  // Sign-less "N mil": the live validator's own helper (R1), so save and send agree.
  return [...out, ...bareMilAmounts(t)]
}

const BARE_NUMBER = '(?<![\\d.,/])(\\d{1,3}(?:[.,\\s]\\d{3})+|\\d{4,7})(?![\\d]|[.,/]\\d)'
/** Bare amounts next to a price word ("cuesta 12000", "el combo queda en 17.900", INT-104). */
const PRICE_WORD_AMOUNT_RE = new RegExp(
  `(?<![\\p{L}])(?:cuestan?|precios?|salen?|quedan?|valen?|total|env[ií]os?|combos?|pag(?:a|ás|as|an|ar))(?![\\p{L}])[^\\p{L}\\p{N}]{0,3}(?:\\p{L}+[^\\p{L}\\p{N}]{1,3}){0,3}?${BARE_NUMBER}`,
  'giu',
)
/** Right after "a / en / son / total / por" ("a 5.000", "Son 5.000 en total"). */
const LEAD_AMOUNT_RE = new RegExp(`(?<![\\p{L}])(?:a|en|son|total|por)\\s+${BARE_NUMBER}`, 'giu')
/** Followed by "cada uno", "c/u", "en total", "por unidad" ("5000 cada uno"). */
const TRAIL_AMOUNT_RE = new RegExp(
  `${BARE_NUMBER}\\s*(?:cada\\s+(?:uno|una|paquete|unidad|caja)|c\\s?\\/\\s?u(?![\\p{L}])|en\\s+total|por\\s+(?:unidad|paquete|caja))`,
  'giu',
)
/** "Envíos desde 2019", "en el 2020", "del año 2018": a year, not an amount (N9). */
// Round 3 item 7: also right after "en" / "el" ("Abrimos en 2020", "Llega en 2026").
const YEAR_BEFORE_RE = /(?<![\p{L}])(?:desde|año|años|en|el|del|hasta)\s*$/iu

function bareAmounts(text: string, re: RegExp): number[] {
  const out: number[] = []
  for (const m of text.matchAll(re)) {
    const num = m[1]
    const at = (m.index ?? 0) + m[0].lastIndexOf(num)
    if (/^(?:19|20)\d\d$/.test(num) && YEAR_BEFORE_RE.test(text.slice(0, at))) continue
    const n = Number(num.replace(/\D/g, ''))
    if (n > 0) out.push(n)
  }
  return out
}

export function priceWordAmountsIn(text: string): number[] {
  const t = tuneText(text)
  return [...new Set([...bareAmounts(t, PRICE_WORD_AMOUNT_RE), ...bareAmounts(t, LEAD_AMOUNT_RE), ...bareAmounts(t, TRAIL_AMOUNT_RE)])]
}

const NUM_WORD =
  '(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\\p{L}+|veinti?\\p{L}*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos)'
const WORD_AMOUNT = `(?:${NUM_WORD}\\s+mil(?:\\s+${NUM_WORD})*|mil(?:\\s+${NUM_WORD})*|${NUM_WORD}(?:\\s+${NUM_WORD})*)`
/**
 * Amounts in words, only when they are money (N9): followed by colones / ₡-words ("doce mil colones", "mil rojos"),
 * or right after a price word ("te sale en doce mil", "cuesta quince mil"). "dos mil años" / "uno o dos" are not.
 * Narrower than promo.ts headlineHasNumberWords on purpose (a reply often says "uno o dos").
 */
const AMOUNT_WORDS_RE = new RegExp(
  [
    `(?<![\\p{L}])${WORD_AMOUNT}\\s+(?:colones|rojos|tejas)(?![\\p{L}])`,
    `(?<![\\p{L}])(?:cuestan?|precios?|salen?|quedan?|valen?|total|env[ií]os?|combos?|pag\\p{L}*|son)(?![\\p{L}])\\s+(?:(?:en|a|de|por|el|la|los|las|solo|solamente)\\s+){0,2}(?:${NUM_WORD}\\s+mil|mil)(?:\\s+${NUM_WORD})*(?![\\p{L}])${NOT_MONEY_AFTER}`,
  ].join('|'),
  'iu',
)

export function hasAmountInWords(text: string): string | null {
  return tuneText(text).match(AMOUNT_WORDS_RE)?.[0] ?? null
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
