/**
 * Shortcut / playbook catalog. Reserved sys_* seeds are generic Spanish.
 * Bodies are data: they never widen what the model may do.
 */

import { AGENT_INTENTS, type AgentIntent } from '@/lib/soft-ai/agent-intents'
import { brandFactTemplateValues, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { fenceDataText, stripFormatChars } from '@/lib/soft-ai/prompt-fence'
import { SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'

/** Saved replies the owner made with "Corregir" (agent-tuning.ts): listed first in the prompt catalog. */
export const TUNE_SHORTCUT_PREFIX = 'fix_'
/** The catalog fits the prompt slice whole (prompt.ts SHORTCUT_CATALOG_PROMPT_MAX). */
export const SHORTCUT_CATALOG_MAX = 4000
/** N3: the owner's corrections never crowd out the other saved replies: at most 5 rows and 40% of the catalog. */
export const TUNE_CATALOG_MAX_ROWS = 5
export const TUNE_CATALOG_MAX_CHARS = Math.floor(SHORTCUT_CATALOG_MAX * 0.4)

export const SHORTCUT_KINDS = [
  'playbook',
  'handoff',
  'purchase_summary',
  'payment_info',
  'payment_ack',
  'payment_rejected',
  'order_confirmed',
  'out_of_hours',
] as const
export type ShortcutKind = (typeof SHORTCUT_KINDS)[number]

export const VERBATIM_ONLY_KINDS: readonly ShortcutKind[] = [
  'handoff',
  'payment_ack',
  'payment_rejected',
  'order_confirmed',
  'out_of_hours',
]

// Accent-safe word edges (JS \b fails after á/ó) and the first-person forms a seller would use (INT-70, 2026-10-09).
const CONFIRMATION_WORDING_RE =
  /(?<![\p{L}\p{N}])(confirmad[oa]|verificad[oa]|recib(?:í|i|imos)\s+(?:tu|el|su|la|los)\s+(?:pago|sinpe|dep[oó]sito|transferencia|plata|dinero)|recibido|pago(?:\s*[:\-–—]\s*|\s+)(?:[✅☑✔👌]\u{FE0F}?[^\S\n]*)?(?:recibido|aplicado|acreditado|aprobado|confirmado|validado)|(?<!(?<![\p{L}])(?:de|el|del|para)\s)pago(?:[^\S\n]*:)?[^\S\n]*(?:✅|☑|✔|👌|ok(?:ay|ey)?(?![\p{L}]))(?=[^\S\n]*(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}][^\S\n]*)*(?:$|[\n.!,;¡¿]))|(?:ya\s+)?(?:me\s+|nos\s+)?(?:lleg[oó]|cay[oó]|entr[oó])\s+(?:tu|el|su|la|los)\s+(?:pago|sinpe|dep[oó]sito|transferencia|plata|dinero)|(?:ya\s+)?(?:est[aá]|qued[oó])\s+(?:pagad[oa]|acreditad[oa]|aplicad[oa]|confirmad[oa])|te\s+confirmo\s+que\s+(?:el|tu|su|la)\s+(?:pago|plata|transferencia|sinpe)|todo\s+bien\s+con\s+(?:el|tu|su)\s+pago|ya\s+qued[oó]|gracias\s+por\s+(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia)|(?:ya\s+)?tenemos\s+(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia)|ya\s+(?:te\s+|le\s+)?(?:lo\s+|la\s+)?(?:preparamos|enviamos|despachamos|mandamos)(?:\s+(?:tu|su|el)\s+pedido)?|(?:tu|el|su)\s+pedido\s+ya\s+(?:est[aá]|va)\s+(?:en\s+camino|en\s+proceso\s+de\s+env[ií]o|listo)|(?:confirm[éó]|verifiqué|verificó|valid[éó]|aprob[éó]|registr[éó]|te\s+confirmo|ya\s+(?:confirmamos|verificamos|validamos|aprobamos|registramos))\s+(?:tu|el|su|la|los)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante|pedido|compra|orden)|recibi[oó]\s+(?:tu|el|su|la|los)\s+(?:pago|sinpe|dep[oó]sito|transferencia|plata|dinero)|(?<=^|[.!?¡¿\n,:;]\s{0,3}|\p{Extended_Pictographic}\u{FE0F}?\s{0,3})(?:pedido|orden|compra)(?:\s*:)?\s+(?:ya\s+)?pagad[oa](?![^\S\n]+antes[^\S\n]+de[^\S\n]+(?:las?[^\S\n]+)?\d)|(?:tu|su)\s+(?:pedido|orden|compra)\s+(?:ya\s+)?(?:est[aá]\s+)?pagad[oa]|(?:(?:tu|el|su)\s+pedido|(?:tu|su)\s+(?:paquete|env[ií]o|orden|compra))\s+(?:ya\s+)?(?:va|est[aá]|sali[oó])\s+(?:en\s+camino|en\s+ruta|de\s+camino)|(?:tu|el|su)\s+(?:pedido|compra|orden)\s+ya\s+sali[oó]|ya\s+sali[oó]\s+(?:tu|el|su)\s+(?:pedido|compra|paquete)|(?:tu|el|su)\s+(?:pedido|compra|orden|pago)\s+(?:ya\s+)?(?:fue|ha\s+sido|est[aá])\s+(?:enviad|despachad|entregad|aprobad|validad|registrad)[oa]|(?:tu|su)\s+(?:paquete|env[ií]o)\s+(?:ya\s+)?(?:fue|ha\s+sido|est[aá])\s+(?:enviad|despachad)[oa]|ya\s+(?:te\s+|le\s+)?(?:lo|la)\s+(?:despach[éó]|envi[éó]|mand[éó]|prepar[éó])|ya\s+(?:te\s+|le\s+)?(?:despach[éó]|envi[éó]|mand[éó]|prepar[éó])\s+(?:tu|el|su)\s+(?:pedido|paquete|env[ií]o|compra)|(?:(?:tu|su)\s+(?:pedido|paquete|compra|orden|env[ií]o)|el\s+pedido)\s+(?:ya\s+)?se\s+(?:envi|despach)[oó]|(?:ya\s+)?se\s+(?:envi|despach)[oó]\s+(?:tu|el|su)\s+(?:pedido|paquete|compra|orden))(?![\p{L}\p{N}])/iu

/**
 * INT-158: Cyrillic / Greek letters that look like Latin ones ("cоnfirmado" with a Cyrillic о) are read as Latin.
 * NFKC (stripFormatChars) already folds full-width / compatibility forms and drops invisible format characters.
 */
const LOOKALIKES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ԝ: 'w',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S',
  α: 'a', ε: 'e', ι: 'i', ο: 'o', ρ: 'p', ν: 'v', τ: 't', κ: 'k',
  Α: 'A', Β: 'B', Ε: 'E', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X',
  // Latin-1 letters NFD cannot split (Verifier r1): "cønfirmado", "recibiðo".
  ø: 'o', Ø: 'O', ð: 'd', Ð: 'D', þ: 'p', Þ: 'P', μ: 'u',
}
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'gu')

/** Emoji letters NFKC keeps (🅒 🅲 🇨): read as A–Z for the check only (INT-158 round 2). */
const EMOJI_LETTER_RE = /[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu
const EMOJI_LETTER_BASES = [0x1f150, 0x1f170, 0x1f1e6]
function emojiLetter(ch: string): string {
  const cp = ch.codePointAt(0) as number
  const base = EMOJI_LETTER_BASES.filter((b) => cp >= b).pop() as number
  return String.fromCharCode(65 + cp - base)
}

/** Other line breaks read as "\n" (U+2028 / NEL start a line on screen, SecureDog r2 F8). */
// eslint-disable-next-line no-control-regex
const LINE_BREAK_RE = /\r\n?|[\x85\u{2028}\u{2029}]/gu
/** Separators shown as a gap — or as nothing (r2 F5): a space in the spaced form, deleted in the joined form. */
// eslint-disable-next-line no-control-regex
const GAP_SEPARATOR_RE = /[\v\f\x1C-\x1F]/gu
/** A word hyphenated across a line break ("confir-\nmado", soft / non-breaking hyphens too). */
const LINE_HYPHEN_RE = /(?<=\p{L})[-\u{AD}\u{2010}-\u{2013}][^\S\n]*\n\s*(?=\p{L})/gu
/** Between two letters: drawn as nothing or a sliver (NEL, U+2028-9, en/thin/hair/narrow spaces; Verifier r2). */
// A letter on one side and a letter or a digit stand-in on the other ("CONFIRMAD" + U+2009 + "0", Verifier r4);
// digit-gap-digit ("₡22 800") is a price.
const NARROW_GAP_IN_WORD_RE =
  /(?:(?<=\p{L})(?:[\x85\u{2028}\u{2029}\u{2000}-\u{200A}\u{202F}\u{205F}]|\r(?!\n))(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?:[\x85\u{2028}\u{2029}\u{2000}-\u{200A}\u{202F}\u{205F}]|\r(?!\n))(?=\p{L}))/gu
/** A digit, superscript, ordinal or modifier letter touching a letter is its own word ("enviado¹", "ºconfirmado", "enviadoᵃ"). */
const DIGIT_EDGE_RE = /(?<=\p{L})(?=[\p{N}ºª\p{Lm}])|(?<=[\p{N}ºª\p{Lm}])(?=\p{L})/gu

/**
 * NFKC, no invisible format characters, look-alikes as Latin, one space between words (INT-158). Round 2: NEL /
 * U+2028-9 are line breaks; vertical tab / form feed / info separators are a space (stripFormatChars would delete them
 * and join the words, L1); WhatsApp markup _ * ~ ` is a space (H1); "confir-\nmado" is one word; 4+ single letters with
 * one separator each ("c o n f i r m a d o", "C•O•N•F…", one per line) are one word. `joined`: separators, markup and
 * in-word hyphens are DELETED instead ("conf\x1Firmado", "con*firm*ado", "CON-FIR-MA-DO"), no digit split.
 */
export function normalizeForConfirmationCheck(text: string, joined = false): string {
  let t = text || ''
  // Joined: NEL / U+2028-9 and narrow / hair spaces inside a word may be drawn as (almost) nothing ("conf\x85irmado").
  if (joined) t = t.replace(NARROW_GAP_IN_WORD_RE, '')
  t = t.replace(LINE_BREAK_RE, '\n').replace(LINE_HYPHEN_RE, '')
  t = t.replace(GAP_SEPARATOR_RE, joined ? '' : ' ')
  if (!joined) t = t.replace(DIGIT_EDGE_RE, ' ')
  t = stripFormatChars(t)
    // Blank-looking fillers used as a space ("vaㅤen camino") stay a space; every other ignorable goes.
    .replace(/[\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}]/gu, ' ')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    // Decomposed first, so an accented look-alike ("ό" = ο + accent) is mapped too.
    .normalize('NFD')
    .replace(LOOKALIKE_RE, (ch) => LOOKALIKES[ch] || ch)
    // A folded letter + a combining accent ("о" + U+0301) becomes one letter again.
    .normalize('NFC')
    .replace(/[èêë]/gu, 'é')
    .replace(/[ÈÊË]/gu, 'É')
    .replace(/[òôö]/gu, 'ó')
    .replace(/[ÒÔÖ]/gu, 'Ó')
    .replace(EMOJI_LETTER_RE, emojiLetter)
    // Parenthesized letters (⒞ 🄒 → "(c)" after NFKC) and in-word ¡ / ¢ ("conf¡rmado", "¢onfirmado"): letters.
    .replace(/\((\p{L})\)/gu, '$1')
    .replace(/(?<=\p{L})¡(?=\p{L})/gu, 'i')
    .replace(/(?<=\p{L})¢|¢(?=\p{L})/gu, 'c')
    .replace(/[_*~`]/gu, joined ? '' : ' ')
  if (joined) t = t.replace(/(?<=\p{L})[-\u{2010}-\u{2014}](?=\p{L})/gu, '')
  return t
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])\p{L}(?:[^\p{L}\p{N}]\p{L}(?![\p{L}\p{N}])){3,}/gu, (m) => m.replace(/[^\p{L}]/gu, ''))
}

/** Same text without accents ("confirmádo" → "confirmado"): a misspelt claim still reads as one. */
function withoutMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC')
}

/**
 * Stand-ins inside a word that has letters ("C0NFIRMAD0", "confirm@do", "€nviado", "c○nfirmado", "CONF│RMADO", "en√iado").
 * SecureDog r3 / Verifier r3: case-aware, sentence punctuation only inside a word, and an "l" reading.
 */
const SKELETON: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '€': 'e',
  '¢': 'c', '¡': 'i', '|': 'i', '!': 'i', '¦': 'i', '‖': 'li', '○': 'o', '◯': 'o', '◦': 'o', '●': 'o', '⭕': 'o', '•': 'o',
  '⚬': 'o', '◌': 'o', '❍': 'o', '☉': 'o', '⚪': 'o', '🔴': 'o', '∙': 'o', '©': 'c', '®': 'r', '°': 'o', '†': 't', '√': 'v',
  '▽': 'v', '│': 'i', '┃': 'i', '╎': 'i', '╏': 'i', '┆': 'i', '┇': 'i', '┊': 'i', '┋': 'i', '▌': 'i', '▐': 'i', '▏': 'i',
  '▕': 'i', '❘': 'i', '❙': 'i', '❚': 'i', '✝': 't', '✞': 't', '✟': 't', '‡': 't', '🔽': 'i', '▼': 'v',
}
/** Stand-ins that also read as l ("||egó", "ap1icado", "PAGO RECIB❘DO", "‖egó"). */
const L_STANDINS = new Set(['1', '|', '¦', '‖', '│', '┃', '╎', '╏', '┆', '┇', '┊', '┋', '▌', '▐', '▏', '▕', '❘', '❙', '❚'])
/** Sentence punctuation is a stand-in only inside a word, never at its edge ("¡C0NFIRMAD0!"). */
const EDGE_PUNCT = new Set(['!', '¡'])
const SKELETON_TOKEN_RE = new RegExp(String.raw`[\p{L}` + Object.keys(SKELETON).join('') + ']+', 'gu')

/** What a look-alike word reads as, with stand-ins as i (asL false) or as l (asL true). Check-only text. */
function skeleton(text: string, asL: boolean): string {
  return text
    .replace(SKELETON_TOKEN_RE, (tok) => {
      if (!/\p{L}/u.test(tok)) return tok
      const chars = [...tok]
      let a = 0
      let b = chars.length
      while (a < b && EDGE_PUNCT.has(chars[a])) a++
      // A trailing bar is trimmed in the i reading only; in the l reading it is an l ("E| pedido", SecureDog r4).
      while (b > a && (EDGE_PUNCT.has(chars[b - 1]) || (!asL && L_STANDINS.has(chars[b - 1]) && !/\p{N}/u.test(chars[b - 1])))) b--
      const core = chars.slice(a, b)
      const letters = core.filter((c) => /\p{L}/u.test(c))
      // An all-caps word ("C0NFlRMAD0"): stand-ins upper-case, a lower-case l is an I.
      const caps = letters.filter((c) => /\p{Lu}/u.test(c)).length >= 2 && !letters.some((c) => c !== 'l' && /\p{Ll}/u.test(c))
      const mapped = core.map((c, i) => {
        if (caps && c === 'l') return 'I'
        // l reading: a capital I reads as l in a lower-case word ("IIegó", "Io despaché") and, after the first letter,
        // in an all-caps word of at most two letters ("EI pedido" = "El pedido", SecureDog r4; not "SINPE", r5).
        if (asL && c === 'I' && (!caps || (i > 0 && letters.length <= 2))) return 'l'
        const m = asL && L_STANDINS.has(c) ? (c === '‖' ? 'll' : 'l') : SKELETON[c]
        if (!m) return c
        return caps ? m.toUpperCase() : m
      })
      return chars.slice(0, a).join('') + mapped.join('') + chars.slice(b).join('')
    })
    .replace(/rn/g, 'm')
    .replace(/cl/g, 'd')
}

/** A run of emoji / symbols glued to a letter on either side (variation selectors, skin tones and ZWJ included). */
const GLUED_RUN_PART = String.raw`(?:[\p{Extended_Pictographic}\p{So}\p{Sm}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}\u{2016}\u{2021}])+`
const GLUED_RUN_RE = new RegExp(String.raw`(?<=\p{L})${GLUED_RUN_PART}|${GLUED_RUN_PART}(?=\p{L})`, 'gu')

/**
 * Chat Spanish drops the accent of the first-person past right after "ya" ("Ya confirme tu pago", "Ya te lo envie"):
 * read it as the accented form — unless a subjunctive frame (cuando, si, hasta que, querés / espero / necesito … que)
 * comes before "ya" in the same sentence ("cuando el equipo
 * ya confirme tu pago", "¿querés que ya te envie…?", Verifier r6), so "Pura vida mae ya te lo envie" is still read
 * (SecureDog r5).
 */
const UNACCENTED_PAST_RE =
  /(?<![\p{L}])(?<!(?<![\p{L}])(?:cuando|apenas|en\s+cuanto|una\s+vez\s+que|si|para\s+que|hasta\s+que|ojal[aá]|(?:quer|quier|esper|necesit|pid|pide|ped|prefer|gust)\p{L}*\s+(?:\p{L}+\s+)?que)(?![\p{L}])[^.!?¡¿\n]{0,80})(ya(?:\s+(?:te|le|se|lo|la|los|las)){0,2}\s+)(confirm|verifiqu|valid|aprob|registr|despach|envi|mand|prepar)e(?![\p{L}])/giu

/**
 * The forms every done-claim check reads (INT-158). Forms 1-2 are always the raw text and the normalised one; then the
 * normalised one without accents ("Confírmamos tu pago"), the unaccented past read as accented ("Ya confirme"), and —
 * in ONE chain, so the tricks combine (SecureDog r5: "Ya te Io envie", "YA C0NFIRME", "PAGO C🔵NFIRMAD0") — for the
 * joined form with and without accents, in the i and the l reading: skeleton → emoji / symbol run glued to a letter
 * read as "o" (🔵 🟢 ⚫ 🍩 ➰) → unaccented past as accented. Patterns without word edges read every form after the
 * second from a word start.
 */
export function confirmationCheckForms(text: string): string[] {
  const raw = text || ''
  const normalized = normalizeForConfirmationCheck(raw)
  const joined = normalizeForConfirmationCheck(raw, true)
  const extra = new Set([withoutMarks(normalized), normalized.replace(UNACCENTED_PAST_RE, '$1$2é')])
  for (const base of [joined, withoutMarks(joined)]) {
    for (const asL of [false, true]) {
      const sk = skeleton(base, asL)
      // With and without the glued-run step: "C0NFIRMAD0✅" must not become "CONFIRMADOo".
      extra.add(sk.replace(UNACCENTED_PAST_RE, '$1$2é'))
      extra.add(sk.replace(GLUED_RUN_RE, 'o').replace(UNACCENTED_PAST_RE, '$1$2é'))
    }
  }
  return [raw, normalized, ...extra]
}

/** Bidi controls that make the screen order differ from the text order (RLO + reversed letters, H2). */
const BIDI_CONTROL_RE = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu
/** Outgoing text without bidi controls: the text that is checked is the text the customer sees (INT-158 H2). */
export function stripBidiControls(text: string): string {
  return (text || '').replace(BIDI_CONTROL_RE, '')
}

/**
 * Characters a model reply may use (SecureDog r2 F1/F2): ASCII, Latin-1 as written (µ ° ½ ñ), general punctuation,
 * currency, arrows, a few math signs, geometric shapes / dingbats / misc symbols (● ★ ✔), emoji.
 */
// eslint-disable-next-line no-control-regex
const MODEL_CHAR_RE = /^[\t\n\r\x20-\x7E\u{A0}-\u{FF}\u{2010}-\u{2027}\u{2030}-\u{205E}\u{20A0}-\u{20C0}\u{2190}-\u{21FF}\u{2212}\u{2248}\u{2260}\u{2264}\u{2265}\u{221E}\u{2219}\u{221A}\u{2500}-\u{259F}\u{25A0}-\u{27BF}\u{27F0}-\u{27FF}]$/u
const EMOJI_RE = /^\p{Extended_Pictographic}$/u
/**
 * A symbol glued between two letters ("CONF│RMADO", "en√iado"): ASCII and Latin-1 punctuation, curly quotes, dashes,
 * the ellipsis, emoji, arrows, ★ and the stand-ins the skeleton already reads (• ⭕ ⚪) are ordinary glue ("Listo✅te
 * paso…", "Lunes→Viernes", "Talla•M"; Verifier r4).
 */
const GLUED_SYMBOL_RE =
  /\p{L}(?:(?!\p{Extended_Pictographic})[^\p{L}\p{N}\p{M}\s\x21-\x7E\u{A1}-\u{BF}\u{D7}\u{F7}\u{2010}-\u{2014}\u{2018}\u{2019}\u{201C}\u{201D}\u{2022}\u{2026}\u{2190}-\u{21FF}\u{2605}\u{2606}\u{25CB}\u{25CF}\u{25EF}\u{25E6}\u{1F3FB}-\u{1F3FF}\u{200D}])+\p{L}/u
const EMOJI_PART_RE = /^[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{FE0E}\u{FE0F}]$/u
const TAG_RE = /^[\u{E0020}-\u{E007F}]$/u
/**
 * INT-158 H3 (model text only): no map can list every look-alike (ı ɑ ᴄ օ Ꮯ ά, Bengali ০, 〇, ⊂, U+FFF9, Hebrew
 * punctuation that turns the line right-to-left …), so a model reply is held for a person when it has any character
 * outside an ALLOW-list: MODEL_CHAR_RE, emoji, anything NFKC folds into the list (full-width, circled, superscript),
 * ZWJ only inside an emoji sequence, the keycap mark only after 0-9 # *, tag characters only in a 🏴 flag. Prices (₡),
 * *bold*, ñ/ü, µg, links and Nº / 1ª pass. The owner's own texts keep the look-alike map only.
 */
export function hasUnsafeLetters(text: string): boolean {
  const nfc = stripBidiControls(text).normalize('NFC')
  if (new RegExp(NARROW_GAP_IN_WORD_RE.source, 'u').test(nfc) || GLUED_SYMBOL_RE.test(nfc)) return true
  const cs = [...nfc]
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i]
    if (MODEL_CHAR_RE.test(ch) || EMOJI_RE.test(ch) || EMOJI_PART_RE.test(ch)) continue
    const folded = [...ch.normalize('NFKC')]
    if (folded.length > 0 && folded.every((c) => MODEL_CHAR_RE.test(c))) continue
    if (ch === '\u{200D}' && i > 0 && i + 1 < cs.length && EMOJI_RE.test(cs[i + 1])) continue
    if (ch === '\u{20E3}' && /^[0-9#*]$/.test(cs[i - 1] === '\u{FE0F}' ? cs[i - 2] ?? '' : cs[i - 1] ?? '')) continue
    if (TAG_RE.test(ch)) {
      let j = i
      while (j > 0 && TAG_RE.test(cs[j - 1])) j--
      if (j > 0 && cs[j - 1] === '\u{1F3F4}') continue
    }
    return true
  }
  return false
}

export type ShortcutDraft = {
  key: string
  title: string
  kind: ShortcutKind
  intents: AgentIntent[]
  keywords: string[]
  body: string
  deliveryMode: 'verbatim' | 'guide'
  isActive?: boolean
  sortOrder?: number
}

export type RuntimeShortcut = ShortcutDraft & {
  id?: string
  isActive: boolean
  sortOrder: number
  /** ISO time the row was created (orders the owner's corrections newest first, N3). */
  createdAt?: string
}

export const RESERVED_SHORTCUT_KEYS = [
  'sys_handoff_payment',
  'sys_handoff_media',
  'sys_handoff_optout',
  'sys_handoff_unavailable',
  'sys_media_ask',
  'sys_payment_soon',
  'sys_purchase_summary',
  'sys_payment_info',
  'sys_payment_ack',
  'sys_payment_rejected',
  'sys_order_confirmed',
  'sys_out_of_hours',
] as const

export type ReservedShortcutKey = (typeof RESERVED_SHORTCUT_KEYS)[number]

export function isReservedShortcutKey(key: string): key is ReservedShortcutKey {
  return (RESERVED_SHORTCUT_KEYS as readonly string[]).includes(key)
}

/**
 * 2026-10-09 (Rafael): the client never hears "una persona del equipo" — the agent speaks as the store's seller.
 * Agents created before keep the old default texts in their own rows; when a stored text is EXACTLY an old default it
 * is upgraded when read (no database writes). Texts the owner edited are left as they are.
 */
/** "¿Cómo compro?": the fixed shipping data list (Rafael 2026-10-16), one item per line. */
export const HOW_TO_BUY_BODY = `Para armar tu pedido pasame:\n${SHIPPING_DATA_LIST}`
/** The previous default of pb_como_comprar (upgraded to HOW_TO_BUY_BODY). */
const HOW_TO_BUY_V2_BODY = 'Para armar tu pedido pasame:\n- Nombre completo\n- Teléfono\n- Dirección exacta (provincia, cantón y distrito)'
/**
 * agents2-format (Rafael 2026-10-16): "¿cómo pago?" lists the method NAMES and asks which one; the chosen method's
 * details go out next ([[PAGO_…]] / inbound-decision). Never every number in one block.
 */
/**
 * Lane C scan 2026-10-22: the engine template "Pedido confirmado". The agent never writes an order (fixed rule 2), so it
 * may never say the order "quedó registrado" (the write_claim check rightly held the old text, which also rendered as
 * "tu pedido  quedó" with no order number). Honest wording: the data is in, the team confirms.
 */
export const ORDER_CONFIRMED_BODY = '¡Gracias! Ya tengo los datos de tu pedido 😊 El equipo lo revisa y te escribe por aquí.'
export const PAYMENT_INFO_BODY = 'Podés pagar con:\n{{brand.payment.methodsList}}\n\n¿Cómo preferís pagar?'
/** Purchase summary: shipping + method names (no numbers), each on its own line. */
export const PURCHASE_SUMMARY_BODY = 'Envío: {{brand.shipping.summary}}\nPago: {{brand.payment.methods}}\n\n¿Lo querés con envío a domicilio o retiro?'

const LEGACY_DEFAULT_BODIES = new Map<string, string>([
  ['Una persona del equipo te ayuda con el pago / SINPE. En un momento te escriben.', '¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊'],
  ['Una persona del equipo revisa lo que enviaste y te responde en breve.', '¡Gracias! Dame un momento y lo reviso 😊'],
  ['Claro — te paso con una persona del equipo. En un momento te escriben.', 'Claro 😊 en un momento te escribe alguien de la tienda.'],
  ['En un momento te atiende una persona del equipo. Gracias por la paciencia.', 'Perfecto, dame un momento y te confirmo 😊'],
  // agents2-format (2026-10-16): "¿cómo pago?" asks which method first; the old defaults dumped every number in one line.
  ['Podés pagar así: {{brand.payment.summary}}. Un comprobante lo revisa una persona del equipo; por acá no se confirma el pago.', PAYMENT_INFO_BODY],
  ['Podés pagar así: {{brand.payment.summary}}. Cuando lo hagás, mandame el comprobante; el pago queda listo cuando lo revisamos 😊', PAYMENT_INFO_BODY],
  ['Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Lo querés con envío a domicilio o retiro?', PURCHASE_SUMMARY_BODY],
  ['Para hacer el pedido solo necesito tu nombre completo, teléfono y dirección exacta. ¿Me los pasás?', HOW_TO_BUY_BODY],
  [HOW_TO_BUY_V2_BODY, HOW_TO_BUY_BODY],
  ['Recibimos tu mensaje de pago. Una persona del equipo lo revisa y te escribe.', '¡Gracias! Ya lo reviso y te confirmo 😊'],
  ['No pudimos aplicar ese pago. Una persona del equipo te explica el siguiente paso.', 'Revisé el pago y todavía no me aparece aplicado. ¿Me reenviás el comprobante? 😊'],
  ['Tu pedido {{order.orderId}} quedó registrado por el equipo. Te escribimos si falta algún dato.', ORDER_CONFIRMED_BODY],
  // Lane C scan 2026-10-22: the agent never writes an order, so never "quedó registrado".
  ['Listo, tu pedido {{order.orderId}} quedó registrado 😊 Te aviso cualquier cosa.', ORDER_CONFIRMED_BODY],
  ['El precio sale del inventario. Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?', 'Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?'],
  // Agentes IA 2.0: previous default of the safe line (sys_handoff_unavailable).
  ['Perfecto, dame un momento y te confirmo 😊', 'Dame un momento y te confirmo 😊'],
])

export function upgradeLegacyShortcutBody(body: string): string {
  return LEGACY_DEFAULT_BODIES.get(body) ?? body
}

export const RESERVED_SHORTCUT_SEEDS: ShortcutDraft[] = [
  {
    key: 'sys_handoff_payment',
    title: 'Pago con una persona',
    kind: 'handoff',
    intents: ['payment_proof', 'human_request'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊',
  },
  {
    key: 'sys_handoff_media',
    title: 'Recibí una imagen',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! Dame un momento y lo reviso 😊',
  },
  {
    key: 'sys_handoff_optout',
    title: 'Cliente pide humano',
    kind: 'handoff',
    intents: ['human_request'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Claro 😊 en un momento te escribe alguien de la tienda.',
  },
  {
    key: 'sys_handoff_unavailable',
    title: 'Sin humano disponible',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    // Agentes IA 2.0 (Rafael 2026-10-15): the safe line for a reply that cannot go out as written; chat stays on IA.
    body: 'Dame un momento y te confirmo 😊',
  },
  {
    // Agentes IA 2.0 (B6): a photo / audio / sticker that is not a receipt: ask in writing, the chat stays on IA.
    key: 'sys_media_ask',
    title: 'Recibí un audio o imagen',
    kind: 'handoff',
    intents: ['other'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! 😊 ¿Me contás por escrito qué necesitás?',
  },
  {
    // Agentes IA 2.0 (B7): payment details are not shared by chat; the team sends them and the chat stays on IA.
    key: 'sys_payment_soon',
    title: 'Te paso cómo pagar',
    kind: 'handoff',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Enseguida te paso cómo pagar 😊',
  },
  {
    key: 'sys_purchase_summary',
    title: 'Resumen de compra',
    kind: 'purchase_summary',
    intents: ['price', 'how_to_buy'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: PURCHASE_SUMMARY_BODY,
  },
  {
    key: 'sys_payment_info',
    title: 'Formas de pago',
    kind: 'payment_info',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: PAYMENT_INFO_BODY,
  },
  {
    key: 'sys_payment_ack',
    title: 'Comprobante recibido',
    kind: 'payment_ack',
    intents: ['payment_proof'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: '¡Gracias! Ya lo reviso y te confirmo 😊',
  },
  {
    key: 'sys_payment_rejected',
    title: 'Pago rechazado',
    kind: 'payment_rejected',
    intents: ['payment_proof'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Revisé el pago y todavía no me aparece aplicado. ¿Me reenviás el comprobante? 😊',
  },
  {
    key: 'sys_order_confirmed',
    title: 'Pedido confirmado',
    kind: 'order_confirmed',
    intents: ['order_status'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: ORDER_CONFIRMED_BODY,
  },
  {
    key: 'sys_out_of_hours',
    title: 'Fuera de horario',
    kind: 'out_of_hours',
    intents: ['hours_location'],
    keywords: [],
    deliveryMode: 'verbatim',
    body: 'Ahora estamos fuera de horario ({{brand.hoursText}}). Te respondemos cuando abramos.',
  },
]

export const STARTER_SHORTCUT_TEMPLATES: ShortcutDraft[] = [
  {
    key: 'precio_envio_pago',
    title: 'Precio + envío + pago',
    kind: 'playbook',
    intents: ['price', 'how_to_buy'],
    keywords: ['precio', 'cuesta', 'vale'],
    deliveryMode: 'guide',
    body: 'Envío: {{brand.shipping.summary}}. Pago: {{brand.payment.summary}}. ¿Cuál producto te interesa?',
  },
  {
    key: 'como_comprar',
    title: 'Cómo comprar paso a paso',
    kind: 'playbook',
    intents: ['how_to_buy'],
    keywords: ['comprar', 'pedido'],
    deliveryMode: 'guide',
    body: 'Para comprar: elegís el producto, te confirmamos precio y envío, y pagás con {{brand.payment.summary}}. ¿Envío o retiro?',
  },
  {
    key: 'formas_de_pago',
    title: 'Formas de pago',
    kind: 'playbook',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Formas de pago: {{brand.payment.summary}}.',
  },
  {
    key: 'ubicacion_retiro',
    title: 'Ubicación y retiro (RA)',
    kind: 'playbook',
    intents: ['hours_location', 'shipping_info'],
    keywords: ['retiro', 'recoger', 'ubicacion'],
    deliveryMode: 'guide',
    body: 'Retiro: {{brand.location.address}}. {{brand.location.pickupInstructions}}',
  },
  {
    key: 'envio_domicilio',
    title: 'Envío a domicilio (EA) y tiempos',
    kind: 'playbook',
    intents: ['shipping_info'],
    keywords: ['envio', 'domicilio'],
    deliveryMode: 'guide',
    body: '{{brand.shipping.summary}}',
  },
  {
    key: 'horario',
    title: 'Horario',
    kind: 'playbook',
    intents: ['hours_location'],
    keywords: ['horario', 'abren', 'cierran'],
    deliveryMode: 'guide',
    body: 'Horario: {{brand.hoursText}}.',
  },
  {
    key: 'sitio_web',
    title: 'Sitio web / catálogo',
    kind: 'playbook',
    intents: ['website'],
    keywords: ['página', 'pagina', 'sitio', 'web', 'catálogo', 'catalogo'],
    deliveryMode: 'guide',
    body: 'Podés ver todo en {{brand.website}}.',
  },
  {
    key: 'seguimiento_pedido',
    title: 'Seguimiento de pedido',
    kind: 'playbook',
    intents: ['order_status'],
    keywords: ['pedido', 'guía', 'guia', 'tracking'],
    deliveryMode: 'guide',
    body: 'Para el estado del pedido usá el número que te dimos. No inventes estados.',
  },
  {
    key: 'foto_producto',
    title: 'Foto del producto',
    kind: 'playbook',
    intents: ['catalog_photo'],
    keywords: ['foto', 'imagen'],
    deliveryMode: 'guide',
    body: 'Las fotos del catálogo se envían cuando estén cargadas. Mientras tanto describí el producto.',
  },
  {
    key: 'garantia_cambios',
    title: 'Garantía y cambios',
    kind: 'playbook',
    intents: ['returns_policy'],
    keywords: ['garantía', 'garantia', 'cambio', 'devolución'],
    deliveryMode: 'guide',
    body: '{{brand.returnsText}}',
  },
]

export function reservedShortcutBody(key: ReservedShortcutKey): string {
  const seed = RESERVED_SHORTCUT_SEEDS.find((row) => row.key === key)
  return seed?.body || ''
}

export function hasConfirmationWording(text: string): boolean {
  if (CONFIRMATION_WORDING_RE.test(text || '')) return true
  return confirmationCheckForms(text).some((form) => CONFIRMATION_WORDING_RE.test(form))
}

/**
 * v53 tests 2026-10-18 ("¿Qué días hacen envíos?" → safe line): "una vez confirmado el pago, sale el mismo día hábil"
 * is how a store explains the NEXT step, not a claim that it happened. ALLOW-LIST (Verifier round 2): the participle
 * is masked only when its WHOLE sentence is exactly one known next-step line —
 *   "(,) una vez / luego de / después de + confirmado / recibido / verificado + (el) pago / comprobante… (,) + a
 *    next step: (tu pedido) sale … / se envía, se despacha, se prepara … / preparamos tu pedido / te llega en N a N
 *    días hábiles / te enviamos el número de guía / te aviso por aquí"
 * — with nothing else in that sentence (no "ya", no other verb, no claim before or after). Every other sentence of the
 * reply, and any sentence that does not match exactly, is checked strictly by CONFIRMATION_WORDING_RE (unchanged,
 * INT-70 / INT-93) and by the payment-status checks. Only the participle is ever masked, never other words.
 */
const NEXT_STEP_WHEN = String.raw`(?:[ \t]+(?:ese[ \t]+mismo[ \t]+d[ií]a(?:[ \t]+h[aá]bil)?|el[ \t]+mismo[ \t]+d[ií]a(?:[ \t]+h[aá]bil)?|lo[ \t]+antes[ \t]+posible|en[ \t]+\d[ \t]*a[ \t]*\d[ \t]+d[ií]as[ \t]+h[aá]biles|hoy[ \t]+mismo|al[ \t]+d[ií]a[ \t]+siguiente(?:[ \t]+h[aá]bil)?|por[ \t]+correos(?:[ \t]+de[ \t]+costa[ \t]+rica)?|por[ \t]+mensajer[ií]a(?:[ \t]+privada)?))*`
// Only forms that can NEVER read as done: "enviamos / preparamos / despachamos / escribimos" are also preterite in
// Spanish ("…, enviamos tu pedido" = "we sent it"), so they are not on the list; the explicit future is.
const FUTURE_VERB = String.raw`(?:vamos[ \t]+a[ \t]+(?:preparar|enviar|despachar|mandar)|te[ \t]+lo[ \t]+vamos[ \t]+a[ \t]+(?:preparar|enviar|despachar|mandar)|(?:te[ \t]+lo[ \t]+|te[ \t]+)?(?:prepararemos|enviaremos|despacharemos|mandaremos))`
const NEXT_STEP = String.raw`(?:(?:(?:tu|el|su)[ \t]+pedido[ \t]+)?sale${NEXT_STEP_WHEN}|(?:(?:tu|el|su)[ \t]+pedido[ \t]+)?se[ \t]+(?:env[ií]a|despacha|prepara)(?:[ \t]+(?:tu|el|su)[ \t]+pedido)?${NEXT_STEP_WHEN}|${FUTURE_VERB}(?:[ \t]+(?:tu|el|su)[ \t]+pedido|[ \t]+el[ \t]+n[uú]mero[ \t]+de[ \t]+gu[ií]a|[ \t]+la[ \t]+gu[ií]a)?${NEXT_STEP_WHEN}|te[ \t]+llega(?:r[aá])?[ \t]+en[ \t]+\d[ \t]*a[ \t]*\d[ \t]+d[ií]as[ \t]+h[aá]biles|te[ \t]+aviso(?:[ \t]+por[ \t]+(?:aqu[ií]|ac[aá]))?)`
const PAY_THING = String.raw`(?:(?:el|tu|su|la|los)[ \t]+)?(?:pago|sinpe|comprobante|transferencia|dep[oó]sito)`
const NEXT_STEP_SENTENCE_RE = new RegExp(
  String.raw`^[ \t,]*(?:una[ \t]+vez|luego[ \t]+de|despu[eé]s[ \t]+de)[ \t]+(confirmad[oa]|recibid[oa]|verificad[oa]|validad[oa])[ \t]+${PAY_THING}[ \t]*,?[ \t]*${NEXT_STEP}[ \t]*[\p{Extended_Pictographic}\u{FE0F}\u{200D} \t]*$`,
  'iu',
)
const SENTENCE_RE = /[^.!?¡¿\n]+/gu
/**
 * Anything in the REST of the reply that reports something already done ("Salió hoy con Correos", "ya va", "hemos
 * despachado", "ha sido enviado", "está despachado", "te confirmo…"): then nothing is masked at all (Verifier round 2).
 */
const DONE_CUE_RE =
  /(?<![\p{L}])(?:ya|fue|fueron|fuimos|sido|listo|lista|listos|en[ \t]+camino|en[ \t]+proceso|en[ \t]+ruta|en[ \t]+tr[aá]nsito|(?:tu|la|su)[ \t]+gu[ií]a[ \t]+es|n[uú]mero[ \t]+de[ \t]+gu[ií]a[ \t]+es|te[ \t]+confirmo|todo[ \t]+est[aá]|(?:he|has|ha|hemos|han)[ \t]+\p{L}+|est[aá]n?[ \t]+\p{L}+(?:ad|id)[oa]s?|salio|quedo|llego|despacho|\p{L}{2,}ó|\p{L}{2,}(?:aron|ieron)|\p{L}{3,}é)(?![\p{L}])/iu

/** A next-step line is short: anything longer is never masked (and bounds every regex run, SecureDog v53 R2-1). */
const NEXT_STEP_MAX_CHARS = 300
/** Single horizontal spaces other than " " / tab (BMP, one code unit each). */
const HORIZONTAL_SPACE_RE = /[\u{A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu

export function maskConditionalConfirmation(text: string): string {
  // One space between words (line breaks kept for the sentence split): the patterns allow at most one optional space
  // between tokens, so no run of spaces can be split many ways (ReDoS). Only spaces / tabs (all the patterns use):
  // other whitespace inside a word ("conf\virmado", U+2028) is kept for the claim checks (INT-158 r2).
  const src = (text || '').replace(/[ \t]+/g, ' ')
  // Next-step lines are matched on a copy where a single wide / narrow space ("pago," + NBSP + "sale") is a plain space —
  // same length, so positions match `src` — and masked in `src`; the claim checks keep the original characters.
  const probe = src.replace(HORIZONTAL_SPACE_RE, ' ')
  let masked = false
  let rest = ''
  let out = ''
  let last = 0
  for (const m of probe.matchAll(SENTENCE_RE)) {
    const start = m.index ?? 0
    const sentence = m[0]
    out += src.slice(last, start)
    last = start + sentence.length
    const original = src.slice(start, last)
    const hit = sentence.length <= NEXT_STEP_MAX_CHARS ? NEXT_STEP_SENTENCE_RE.exec(sentence) : null
    if (!hit) {
      rest += `${original}\n`
      out += original
      continue
    }
    const at = sentence.toLowerCase().indexOf(hit[1].toLowerCase())
    if (at < 0) {
      out += original
      continue
    }
    masked = true
    out += original.slice(0, at) + '·'.repeat(hit[1].length) + original.slice(at + hit[1].length)
  }
  out += src.slice(last)
  // SecureDog round 3: invisible format characters ("Ya​ salió") never hide a done cue.
  return masked && !DONE_CUE_RE.test(normalizeForConfirmationCheck(rest)) ? out : src
}

/** The agent's own reply claims a payment / order happened (a conditional next-step participle excluded). */
export function hasOutboundConfirmationClaim(text: string): boolean {
  return hasConfirmationWording(maskConditionalConfirmation(text))
}

export function validateShortcutForSave(draft: {
  key: string
  title: string
  kind: string
  body: string
  deliveryMode: string
  keywords?: string[]
  intents?: string[]
}): { ok: true } | { ok: false; code: string } {
  if (!/^[a-z0-9_]{2,40}$/.test(draft.key)) return { ok: false, code: 'shortcut_key_invalid' }
  if (!draft.title.trim() || draft.title.trim().length > 60) {
    return { ok: false, code: 'shortcut_title_invalid' }
  }
  if (!(SHORTCUT_KINDS as readonly string[]).includes(draft.kind)) {
    return { ok: false, code: 'shortcut_kind_invalid' }
  }
  const body = draft.body.trim()
  if (!body || body.length > 1500) return { ok: false, code: 'shortcut_body_invalid' }
  if (draft.deliveryMode !== 'verbatim' && draft.deliveryMode !== 'guide') {
    return { ok: false, code: 'shortcut_delivery_invalid' }
  }
  if (
    (VERBATIM_ONLY_KINDS as readonly string[]).includes(draft.kind) &&
    draft.deliveryMode !== 'verbatim'
  ) {
    return { ok: false, code: 'shortcut_delivery_invalid' }
  }
  if ((draft.keywords || []).length > 20) return { ok: false, code: 'shortcut_keywords_invalid' }
  for (const intent of draft.intents || []) {
    if (!(AGENT_INTENTS as readonly string[]).includes(intent)) {
      return { ok: false, code: 'shortcut_intent_invalid' }
    }
  }
  if (hasConfirmationWording(body)) return { ok: false, code: 'confirmation_wording' }
  return { ok: true }
}

export type TemplateContext = {
  facts: BrandFacts
  inventoryPricesBySku?: Record<string, number>
  clientFirstName?: string | null
  orderId?: string | null
}

export const MISSING_FACT_CHIP_HINT = 'Completá Datos de la marca o cargá tus atajos'

const TEMPLATE_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.:]+)\s*\}\}/g

/** Customer text for a starter chip. Missing brand facts disable the chip. */
export function previewStarterChip(
  template: Pick<ShortcutDraft, 'body'>,
  facts: BrandFacts,
): { body: string; missing: string[]; disabled: boolean; hint: string | null } {
  const values = brandFactTemplateValues(facts)
  const missing: string[] = []
  for (const match of template.body.matchAll(TEMPLATE_TOKEN_RE)) {
    const token = match[1]
    if (!token || token.startsWith('inventory.price:')) continue
    if (token === 'client.firstName' || token === 'order.orderId') continue
    if (!values[token]?.trim()) missing.push(token)
  }
  const body = renderShortcutTemplate(template.body, { facts }).replace(/\s{2,}/g, ' ').trim()
  const disabled = missing.length > 0 || !body
  return {
    body,
    missing,
    disabled,
    hint: disabled ? MISSING_FACT_CHIP_HINT : null,
  }
}

export function renderShortcutTemplate(body: string, ctx: TemplateContext): string {
  const values = brandFactTemplateValues(ctx.facts)
  return body.replace(/\{\{\s*([a-zA-Z0-9_.:]+)\s*\}\}/g, (_match, token: string) => {
    if (token.startsWith('inventory.price:')) {
      const sku = token.slice('inventory.price:'.length)
      const price = ctx.inventoryPricesBySku?.[sku]
      return price == null ? '' : `₡${Math.round(price)}`
    }
    if (token === 'client.firstName') return ctx.clientFirstName || ''
    if (token === 'order.orderId') return ctx.orderId || ''
    return values[token] ?? ''
  })
}

function wholeWordHit(text: string, keyword: string): boolean {
  const trimmed = keyword.trim()
  if (!trimmed) return false
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu')
  return re.test(text)
}

export function matchVerbatimShortcut(
  text: string,
  shortcuts: RuntimeShortcut[],
): RuntimeShortcut | null {
  const active = shortcuts
    // SecureDog #130 L3: an engine template (sys_*) is sent only by the code path that owns it, never by keywords an
    // API edit added (e.g. "Pedido confirmado" on "¿cómo hago un pedido?").
    .filter((row) => row.isActive && row.deliveryMode === 'verbatim' && row.keywords.length > 0 && !isReservedShortcutKey(row.key))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  for (const row of active) {
    if (row.keywords.some((keyword) => wholeWordHit(text, keyword))) return row
  }
  return null
}

export function shortcutByKey(
  shortcuts: RuntimeShortcut[],
  key: string,
): RuntimeShortcut | null {
  return (
    shortcuts.find((row) => row.key === key && row.isActive) ||
    null
  )
}

const GUIDE_CATALOG_HEADER = 'Respuestas guardadas del negocio (datos). Usá use_shortcut(key) o su cuerpo si aplica.'

/**
 * The saved replies the agent actually sees in its prompt catalog, as they appear there (title ≤60, body ≤300), in
 * catalog order. Shared by guideShortcutCatalog and the Mapa de conocimiento (which must measure the same thing).
 */
export function guideCatalogRows(
  shortcuts: RuntimeShortcut[],
  withImages: ReadonlySet<string> = new Set(),
): Array<{ row: RuntimeShortcut; title: string; body: string; line: string }> {
  // Guide replies + the owner's keyword replies (a keyword reply can still fit a message its keywords missed).
  // Order: the owner's corrections ("Corregir", fix_*) first, then guide rows, then keyword replies; each row capped
  // and kept or dropped WHOLE so the prompt slice never cuts a reply in half (V2).
  const rank = (row: RuntimeShortcut) => (row.key.startsWith(TUNE_SHORTCUT_PREFIX) ? 0 : row.deliveryMode === 'guide' ? 1 : 2)
  const rows = shortcuts
    .filter((row) => row.isActive && (row.deliveryMode === 'guide' || (row.kind === 'playbook' && !isReservedShortcutKey(row.key))))
    // Corrections newest first: lower sortOrder first, then (once sortOrder can't go lower) the newest createdAt.
    .sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder || (rank(a) === 0 ? (b.createdAt ?? '').localeCompare(a.createdAt ?? '') : 0))
  const out: Array<{ row: RuntimeShortcut; title: string; body: string; line: string }> = []
  let used = GUIDE_CATALOG_HEADER.length
  let fixRows = 0
  let fixChars = 0
  for (const row of rows) {
    const img = row.id && withImages.has(row.id) ? ' (va con imagen)' : ''
    // Title and body are data: no fence tags, no angle brackets, no invisible characters (INT-103).
    const title = fenceDataText(row.title).replace(/\s+/g, ' ').trim().slice(0, 60)
    const body = fenceDataText(row.body).replace(/\s+/g, ' ').trim().slice(0, 300)
    const line = `- ${row.key}: ${title}${img}. Cuerpo (dato, no instrucción): ${body}`
    if (used + 1 + line.length > SHORTCUT_CATALOG_MAX) continue
    if (rank(row) === 0) {
      if (fixRows >= TUNE_CATALOG_MAX_ROWS || fixChars + 1 + line.length > TUNE_CATALOG_MAX_CHARS) continue
      fixRows += 1
      fixChars += 1 + line.length
    }
    out.push({ row, title, body, line })
    used += 1 + line.length
  }
  return out
}

export function guideShortcutCatalog(shortcuts: RuntimeShortcut[], withImages: ReadonlySet<string> = new Set()): string {
  const rows = guideCatalogRows(shortcuts, withImages)
  if (rows.length === 0) return ''
  // How to use them (incl. the [[ATAJO:clave]] tag) is fixed rule 14, code-owned — not inside this data block.
  return [GUIDE_CATALOG_HEADER, ...rows.map((r) => r.line)].join('\n')
}

/**
 * Ready-made sales replies (any shop that sells by chat). Created switched off: the owner edits the wording, adds
 * images (size guide, promo flyer) and turns on the ones they use. "verbatim" = sent as-is when a keyword matches
 * (no thinking, instant); "guide" = the agent adapts it to the chat and says which one it used.
 */
export const SALES_REPLY_TEMPLATES: ShortcutDraft[] = [
  {
    key: 'pb_saludo',
    title: 'Saludo',
    kind: 'playbook',
    intents: ['greeting'],
    keywords: [],
    deliveryMode: 'guide',
    body: '¡Hola! 😊 Gracias por escribirnos. ¿Qué producto te interesa?',
  },
  {
    key: 'pb_tallas',
    title: 'Guía de tallas',
    kind: 'playbook',
    intents: ['catalog_photo'],
    keywords: ['talla', 'tallas', 'medida', 'medidas'],
    deliveryMode: 'verbatim',
    body: 'Te paso la guía de tallas 👇 Decime cuánto medís y pesás y te digo cuál te queda mejor.',
  },
  {
    key: 'pb_promo',
    title: 'Promoción',
    kind: 'playbook',
    intents: ['price'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Te paso la promo que tenemos ahora 👇 ¿Cuál te gustaría?',
  },
  {
    key: 'pb_envio',
    title: 'Envío',
    kind: 'playbook',
    intents: ['shipping_info'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Hacemos envíos. Decime a dónde sería y te digo el precio y cuánto tarda.',
  },
  {
    key: 'pb_contra_entrega',
    title: 'Pago contra entrega',
    kind: 'playbook',
    intents: ['payment_info'],
    keywords: [],
    deliveryMode: 'guide',
    body: 'Te digo si en tu zona se puede pagar contra entrega: ¿a dónde sería el envío?',
  },
  {
    key: 'pb_como_comprar',
    title: 'Cómo comprar',
    kind: 'playbook',
    intents: ['how_to_buy'],
    keywords: [],
    deliveryMode: 'guide',
    // agents2-format: the data as a vertical list (one item per line), never one long sentence.
    // Rafael 2026-10-16: the fixed shipping list (order-data-list.ts), not negotiable.
    body: HOW_TO_BUY_BODY,
  },
  {
    key: 'pb_post_venta',
    title: 'Después de la compra',
    kind: 'playbook',
    intents: ['order_status'],
    keywords: [],
    deliveryMode: 'guide',
    body: '¡Gracias por tu compra! 😊 Cualquier cosa del pedido me escribís por aquí.',
  },
]
