/**
 * Ley 8968 scrubber for real chats leaving the DB (exports, exam banks). Pure, offline, no DB.
 * DATA-65: the exam-bank scrubber only removed the chat's own contact name; this also removes greeted names,
 * names from the linked order, profile/IG links, @handles, phones, emails, addresses and tracking numbers.
 */
import { redactSensitiveForProvider } from '@/lib/soft-ai/llm/redact'

const L_BEFORE = String.raw`(?<![\p{L}\p{N}])`
const L_AFTER = String.raw`(?![\p{L}\p{N}])`
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Places that are also first names ("José"): scrubbed when they are the contact's name, kept in "San José". */
const PLACES = new Set(['san', 'josé', 'jose', 'cartago', 'heredia', 'alajuela', 'limón', 'limon', 'puntarenas', 'guanacaste', 'costa', 'rica'])
/** Words that look like names after "hola"/"gracias" but are not people (brands, places, greetings). */
const NOT_A_NAME = new Set(
  [
    'hola', 'buenas', 'buenos', 'gracias', 'claro', 'perfecto', 'listo', 'ok', 'si', 'sí', 'costa', 'rica', 'forge',
    'deepclean', 'deepsleep', 'patchhouse', 'patch', 'house', 'pura', 'sonrisa', 'sleeping', 'cartago', 'heredia',
    'alajuela', 'san', 'josé', 'jose', 'limón', 'limon', 'puntarenas', 'guanacaste', 'que', 'qué', 'muchas', 'mil',
    'a', 'de', 'por', 'para', 'con', 'tardes', 'noches', 'días', 'dias', 'pura', 'vida', 'amigo', 'amiga', 'mae',
    'señor', 'señora', 'senor', 'senora', 'cliente', 'muchísimas', 'muchisimas', 'igualmente', 'bendiciones',
    'todo', 'todos', 'excelente', 'super', 'súper', 'genial', 'tranqui', 'tranquilo', 'tranquila', 'el', 'la', 'un', 'una',
  ].map((w) => w.toLowerCase()),
)

const ADDRESS_WORDS =
  /(?<![\p{L}])(calle|avenida|ave\.?|casa|frente|metros|esquina|barrio|residencial|condominio|apartamento|apto|del\s+(?:palo|super|parque|iglesia)|\d{2,3}\s?m(?:ts)?(?![\p{L}])|norte|sur|este|oeste|varas|port[oó]n|contiguo|diagonal|costado)(?![\p{L}])/giu
const DATA_LABELS =
  /(?<![\p{L}\p{N}])(nombre( completo)?|tel[eé]fono|celular|provincia|cant[oó]n|distrito|direcci[oó]n|señas|correo|c[eé]dula)(?![\p{L}\p{N}])/giu

/** Greeting in any case ("Gracias", "HOLA"), then a Capitalized name: the name part must stay case-sensitive. */
const GREETED_NAME =
  /(?<![\p{L}])([Hh][Oo][Ll][Aa]+|[Bb]uen[oa]s(?: [Tt]ardes| [Nn]oches| [Dd][ií]as)?|(?:[Mm]uchas )?[Gg]racias|[Ss]aludos|[Ee]stimad[oa]|[Dd]on|[Dd]oña|[Cc]on gusto|[Cc]laro|[Pp]erfecto|[Ll]isto)([,!¡\s]+)((?:\p{Lu}[\p{Ll}'-]+\s?){1,3})/gu

export const DATA_BLOCK = '[datos de envío del cliente]'

/** Splits names ("María José Pérez", "@maria.jose_22") into words worth scrubbing (3+ letters, not common words). */
export function nameWords(...names: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const n of names) {
    for (const w of String(n || '').split(/[\s._\-@|/,()]+/u)) {
      const clean = w.replace(/[^\p{L}'-]/gu, '')
      const low = clean.toLowerCase()
      if (clean.length >= 3 && (PLACES.has(low) || !NOT_A_NAME.has(low))) out.add(clean)
    }
  }
  return [...out]
}

export type ScrubOptions = {
  /** Names known for this chat: contact name, IG username, order customer name. */
  names?: string[]
  /** Squeeze double spaces and trim (default true). */
  tidy?: boolean
  /** Collapse a message that is mostly a shipping-data block into one placeholder (default true). */
  collapseDataBlocks?: boolean
}

export function scrubChatText(text: string, opts: ScrubOptions = {}): string {
  const original = text || ''
  let t = redactSensitiveForProvider(original)
  // Links first (they contain @, digits and names).
  t = t.replace(/https?:\/\/\S+|(?:www\.)?(?:instagram\.com|instagr\.am|ig\.me|wa\.me|facebook\.com|fb\.me|m\.me|tiktok\.com)\/\S*/giu, '[enlace]')
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
  t = t.replace(/(?<![\p{L}\p{N}])@[\w.]{2,30}/gu, '[usuario]')
  // Tracking: Correos (XX123456789CR), PY/courier guides and long codes with letters+digits.
  t = t.replace(/(?<![\p{L}\p{N}])[A-Z]{2}\d{8,10}[A-Z]{2}(?![\p{L}\p{N}])/gu, '[guía]')
  t = t.replace(/(?<![\p{L}\p{N}])(gu[ií]a|tracking|rastreo|seguimiento)(\s*(?:#|n[uú]mero|:|es)?\s*)([A-Z0-9-]{6,})/giu, '$1$2[guía]')
  t = t.replace(/\bCR\d{2}[\d\s]{10,}\b/gi, '[cuenta]')
  // Phones, cédulas, accounts — also written with dots or spaces ("8888.8888", "1 1234 0567"). Prices ("₡14 900") stay:
  // they have at most 6 digits, the phone rule needs 7+.
  t = t.replace(/(?<![\p{L}\p{N}₡$])\+?\d[\d\s.-]{6,}\d(?![\p{L}\p{N}])/gu, (m) => (m.replace(/\D/g, '').length >= 7 ? '[número]' : m))
  for (const w of opts.names ?? []) {
    const notPlace = PLACES.has(w.toLowerCase()) ? String.raw`(?<!san\s)(?<!costa\s)` : ''
    t = t.replace(new RegExp(`${L_BEFORE}${notPlace}${esc(w)}${L_AFTER}`, 'giu'), '[nombre]')
  }
  // "Soy Ana", "me llamo …", "a nombre de …": up to 4 words after it are a name.
  t = t.replace(/(?<![\p{L}\p{N}])(soy|me llamo|mi nombre es|a nombre de)\s+((?:[\p{L}'-]+\s?){1,4})/giu, (m, intro: string, words: string) => {
    if (/^(de|del|la|el|una?|cliente|nuev[oa]|mayor|menor|estudiante|al[eé]rgic[oa]|\[nombre\])(?![\p{L}])/iu.test(words)) return m
    return `${intro} [nombre] `
  })
  // Greeted names: "Hola Ana", "Gracias María José", "Buenas tardes Carlos", "Con gusto Pedro".
  t = t.replace(
    GREETED_NAME,
    (m, g: string, sep: string, names: string) => {
      const words = names.trim().split(/\s+/)
      if (words.every((w) => NOT_A_NAME.has(w.toLowerCase()))) return m
      return `${g}${sep}[nombre] `
    },
  )
  t = t.replace(/(?<![\p{L}])(calle|avenida|barrio|residencial|condominio|apartamento|urbanizaci[oó]n)\s+[^\n.,]{2,40}/giu, '[dirección]')
  if (opts.collapseDataBlocks !== false && looksLikeDataBlock(original, t)) return DATA_BLOCK
  return opts.tidy === false ? t : t.replace(/[ \t]{2,}/g, ' ').trim()
}

const PROVINCES = /(?<![\p{L}])(san jos[eé]|alajuela|cartago|heredia|guanacaste|puntarenas|lim[oó]n)(?![\p{L}])/giu

/**
 * A customer's data / order block (it usually starts with the full name, which no word rule can catch):
 * labels or address words, a forwarded "#ORD-…" order, or several lines with 2+ contact pieces (phone, email,
 * link, province, "Dirección"). `scrubbed` is the text after the other rules (placeholders already in).
 */
export function looksLikeDataBlock(original: string, scrubbed: string): boolean {
  const addressHits = (original.match(ADDRESS_WORDS) || []).length
  const labels = (original.match(DATA_LABELS) || []).length
  if (labels >= 2 || addressHits >= 2 || (addressHits >= 1 && /\[número\]/.test(scrubbed))) return true
  if (/#?ORD-\s?\d/i.test(original) && /\[(número|guía|correo)\]/.test(scrubbed)) return true
  const lines = original.split(/\n/).filter((l) => l.trim()).length
  const pieces =
    (scrubbed.match(/\[(número|correo|enlace|guía)\]/g) || []).length + Math.min(1, (original.match(PROVINCES) || []).length) + Math.min(1, labels)
  return lines >= 3 && pieces >= 2
}
