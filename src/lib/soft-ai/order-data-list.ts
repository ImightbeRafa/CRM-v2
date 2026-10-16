/**
 * Shipping data request (Rafael 2026-10-16, not negotiable): whenever an agent asks for the shipping data it is this
 * exact list, one item per line — what any Costa Rica shipment needs. Pickup (retiro) asks only the first three.
 * Pure and client-safe: the live turn, Probar and the saved replies all go through `canonicalizeOrderDataList`.
 */

export const SHIPPING_DATA_FIELDS = [
  'Nombre completo',
  'Teléfono',
  'Correo (opcional)',
  'Provincia',
  'Cantón',
  'Distrito',
  'Dirección exacta con señas',
] as const

export const PICKUP_DATA_FIELDS = ['Nombre completo', 'Teléfono', 'Correo (opcional)'] as const

export const SHIPPING_DATA_LIST = SHIPPING_DATA_FIELDS.map((f) => `- ${f}`).join('\n')
export const PICKUP_DATA_LIST = PICKUP_DATA_FIELDS.map((f) => `- ${f}`).join('\n')

const LIST_ITEM_RE = /^\s*(?:[-•*–]|\d{1,2}[.)])\s+/

type Field = 'name' | 'phone' | 'email' | 'location' | 'address'

const KEY_WORDS: Array<[RegExp, Field]> = [
  [/^(nombre|apellidos?)$/, 'name'],
  [/^(telefono|celular)$/, 'phone'],
  [/^(correo|email|e-?mail)$/, 'email'],
  [/^(provincia|canton|distrito)$/, 'location'],
  [/^(direccion|senas|ubicacion)$/, 'address'],
]

/** Words that may surround a field name ("Dirección exacta con otras señas", "Número de teléfono", "tu correo"). */
const FILLER = new Set([
  'completo', 'completa', 'exacta', 'exacto', 'con', 'otras', 'de', 'del', 'y', 'e', 'o', 'tu', 'su', 'el', 'la', 'los',
  'las', 'numero', 'electronico', 'opcional', 'para', 'envio', 'entrega', 'si', 'es', 'otro', 'otra', 'distinto', 'a',
  'este', 'chat', 'contacto', 'punto', 'domicilio', 'casa', 'mas', 'detallada', 'al', 'en', 'por', 'referencia',
  'referencias', 'adicionales', 'exactas',
])

/**
 * A lead-in that is not a fresh shipping-data request: data already received, a follow-up for the missing pieces, an
 * order lookup, an invoice / exchange / warranty, contact channels. Those messages are left as written.
 */
const NOT_A_REQUEST_LEAD_RE =
  /\b(ya tengo|ya tenemos|ya recib\w*|recibi|recibimos|recibido|(me|nos|solo|solo me|solo nos) falta\w*|faltaria\w*|para buscar|buscar tu|rastre\w*|factura\w*|para el cambio|cambio de|devoluci\w*|garant\w*|reclamo|escribinos|escribenos|contactanos|atendemos|canales|resumen|anotado|ya anote|registrado|tus datos son|los datos que)\b/

/** Anything marking the item as done / received: ✅ ✔ ☑ ✓ ✗ ❌ 👍 👌 🆗. */
const CHECKMARK_RE = /[✅✔☑✓✗❌👍👌🆗]/u

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Emoji / pictographs (incl. skin tones and joiners) carry no meaning in a label. */
const stripPictographs = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, ' ')

/**
 * The fields one item names, or null when it is not purely a field label ("- Nombre: Ana" holds a value, "- Nombre ✅"
 * is already received, "- Focus ₡9 900" is a product — all null, so summaries and product lists are never touched).
 */
function itemFields(raw: string): Set<Field> | null {
  if (CHECKMARK_RE.test(raw)) return null
  let s = stripPictographs(raw.replace(LIST_ITEM_RE, '')).trim()
  s = s.replace(/\*+|_+/g, '').replace(/:\s*$/, '').trim()
  if (!s || s.length > 70) return null
  if (/:\s*\S/.test(s)) return null
  const words = norm(s.replace(/\([^)]*\)/g, ' '))
    .split(/[\s,/;.·]+/)
    .filter(Boolean)
  if (!words.length) return null
  const found = new Set<Field>()
  for (const w of words) {
    const hit = KEY_WORDS.find(([re]) => re.test(w))
    if (hit) found.add(hit[1])
    else if (!FILLER.has(w)) return null
  }
  return found.size ? found : null
}

/**
 * A shipping-data request: it names a place or the address (so it is about a delivery) plus name or phone.
 * Name / phone / email alone is left as written (pickup list, order lookup, invoice) — the prompt asks for those.
 */
function isShippingRequest(fields: Set<Field>): boolean {
  return (fields.has('location') || fields.has('address')) && (fields.has('name') || fields.has('phone'))
}

/**
 * Only the lead-in's last clause counts ("Sí, tenemos envío a Cartago 🚚 Para armar tu pedido pasame:" is judged on
 * "Para armar tu pedido pasame:").
 */
const leadOk = (lead: string) => {
  const clauses = lead.split(/[.!?]+|\p{Extended_Pictographic}+/u).filter((c) => c.trim())
  return !NOT_A_REQUEST_LEAD_RE.test(norm(clauses[clauses.length - 1] || ''))
}

/** "necesito tu nombre…" / "pasame tu nombre…" without a colon: the verb ends the lead-in. */
const ASK_VERB_RE = /^(.*?\b(?:necesito|pas[aá]me|me pas[aá]s|me (?:das|dar[ií]as|ayud[aá]s con|compart[ií]s)|env[ií]ame|mand[aá]me))\s+(.+)$/iu

/**
 * One line that lists the data inline: "Para armar tu pedido pasame: nombre, teléfono y dirección", the slash / dot
 * form "Pasame: Nombre / Teléfono / …", "…necesito tu nombre completo, teléfono y dirección exacta 😊" or the emoji form
 * "👤 Nombre completo 📞 Teléfono 📍 Provincia / Cantón / Distrito …". Returns the lead-in (ends in ':') or null.
 */
function inlineRequest(line: string): string | null {
  if (LIST_ITEM_RE.test(line)) return null
  let lead = ''
  let body = line
  const colon = line.indexOf(':')
  if (colon >= 0) {
    lead = line.slice(0, colon + 1).trim()
    body = line.slice(colon + 1)
  } else {
    const verb = ASK_VERB_RE.exec(line)
    if (verb) {
      lead = `${verb[1].trim()}:`
      body = verb[2]
    }
  }
  // A row of ✅ / 👍 is data already received, never a request ("Dale 👍 pasame…" in the lead-in is fine).
  if (!body.trim() || CHECKMARK_RE.test(body)) return null
  const emojiSplit = /\p{Extended_Pictographic}/u.test(body.replace(/[\p{Extended_Pictographic}️\s.!]+$/u, ''))
  // Without a lead-in, only the emoji-separated form counts (a plain sentence is left alone).
  if (!lead && !emojiSplit) return null
  if (lead && !leadOk(lead)) return null
  const pieces = stripTrailing(body)
    .split(emojiSplit ? /[\p{Extended_Pictographic}‍️]+|,|;|\s·\s/u : /,|;|\s+y\s+|\s+e\s+|\s\/\s|\s·\s/u)
    .map((p) => p.trim())
    .filter(Boolean)
  if (pieces.length < 2) return null
  const fields = new Set<Field>()
  for (const p of pieces) {
    const f = itemFields(p)
    if (!f) return null
    f.forEach((x) => fields.add(x))
  }
  return isShippingRequest(fields) ? lead : null
}

const stripTrailing = (s: string) => s.replace(/[\s.!?¿¡]*[\p{Extended_Pictographic}️\s.!?]*$/u, '')

/**
 * The list's lead-in: the line right above it, or — across blank lines — a line ending in ':' (the lead-in sent as its
 * own message). Otherwise '' (an earlier paragraph is not the lead-in).
 */
function leadAbove(lines: string[], index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!lines[i].trim()) continue
    if (LIST_ITEM_RE.test(lines[i])) return ''
    return i === index - 1 || /:\s*$/.test(lines[i]) ? lines[i] : ''
  }
  return ''
}

/**
 * Rewrite every shipping-data request in `text` to the fixed list. Lists keep their lead-in line; an extra business
 * field ("- Talla") stays after the list. Anything else is untouched. Pure.
 */
export function canonicalizeOrderDataList(text: string): string {
  if (!text) return text
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; ) {
    if (LIST_ITEM_RE.test(lines[i])) {
      // A run of items. Blank lines between items belong to the run (one message, not one per item) only when the
      // item after the gap is itself a field label (a product list in the next paragraph stays apart).
      const start = i
      let end = i
      for (let j = i + 1; j < lines.length; j += 1) {
        if (LIST_ITEM_RE.test(lines[j])) {
          if (j > end + 1 && !itemFields(lines[j])) break
          end = j
        } else if (lines[j].trim()) break
      }
      const run = lines.slice(start, end + 1)
      const items = run.filter((l) => l.trim())
      const fields = new Set<Field>()
      const extras: string[] = []
      let labels = 0
      for (const line of items) {
        const f = itemFields(line)
        if (f) {
          labels += 1
          f.forEach((x) => fields.add(x))
        } else extras.push(line)
      }
      const lead = leadAbove(lines, start)
      if (labels >= 2 && labels > extras.length && isShippingRequest(fields) && leadOk(lead) && !items.some((l) => CHECKMARK_RE.test(l))) {
        out.push(SHIPPING_DATA_LIST, ...extras.map((l) => `- ${l.replace(LIST_ITEM_RE, '').trim()}`))
      } else out.push(...run)
      i = end + 1
      continue
    }
    const lead = inlineRequest(lines[i])
    if (lead !== null) {
      if (lead) out.push(lead)
      out.push(SHIPPING_DATA_LIST)
    } else out.push(lines[i])
    i += 1
  }
  return out.join('\n')
}
