/**
 * "Crear pedido" from a chat (Rafael 2026-10-17): the order form opens already filled from what the customer wrote —
 * name, phone, email, address, delivery / pickup, contra entrega and the products they asked for. A person reviews and
 * submits; nothing is created on its own. Pure helpers (no I/O) so live and tests share them.
 *
 * Verifier round 1: free chat text is NOT a pasted customer block. Only values that are clearly the customer's data are
 * used — a labelled line ("Nombre: …"), a valid email, a phone alone on its line, a location that exists in Costa Rica —
 * or what the AI extracted. Anything else stays empty so the chat's own name / WhatsApp number is kept.
 */
import { costaRicaLocations } from '@/app/ventas/components/costaRicaLocations'

export type PrefillProduct = { id: string; name: string; type: string; baseCost: number; cantidad: number }

export type PrefillCustomer = {
  name: string
  phone: string
  email: string
  province: string
  canton: string
  district: string
  address: string
}

export type OrderPrefillChoices = {
  orderType: 'EA' | 'RA' | null
  paymentChoice: 'contra_entrega' | null
}

export const EMPTY_PREFILL_CUSTOMER: PrefillCustomer = { name: '', phone: '', email: '', province: '', canton: '', district: '', address: '' }

const PLACEHOLDER_RE = /^\s*\[[a-z_ ]+\]\s*$/i
/** Words that never identify a product on their own ("GLP Patch" → ["glp"]). */
const GENERIC_WORDS = new Set(['patch', 'patches', 'parche', 'parches', 'de', 'del', 'la', 'el', 'los', 'las', 'paquete', 'kit', 'combo', 'y', 'con'])
/** How customers write the product words in Spanish. */
const ALIASES: Record<string, string> = { energia: 'energy', dopamina: 'dopamine', estres: 'stress', arnes: 'arness' }
const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }

export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function tokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => ALIASES[t] ?? t)
}

/** Customer text worth reading: their own messages, without "[image]" / "[ig_post]" placeholders. */
export function customerTextsForPrefill(messages: Array<{ direction: string; content?: string | null }>): string[] {
  return messages
    .filter((m) => m.direction === 'inbound')
    .map((m) => String(m.content || '').trim())
    .filter((t) => t && !PLACEHOLDER_RE.test(t))
}

/**
 * SecureDog H1: the one bounded copy of the customer's text every helper reads — the newest 30 messages, 1 000 chars
 * each, 6 000 in total (newest kept). Customer text is untrusted input on a shared server.
 */
export function boundedCustomerTexts(texts: string[]): string[] {
  const out: string[] = []
  let total = 0
  for (const t of texts.slice(-30).reverse()) {
    const cut = t.slice(0, 1_000)
    if (total + cut.length > 6_000) break
    out.unshift(cut)
    total += cut.length
  }
  return out
}

const MAX_LINES = 120
const MAX_LINE = 300

// ── Customer data ──────────────────────────────────────────────────────────────────────────────────────────────────

const LABELS: Array<[keyof PrefillCustomer, RegExp]> = [
  ['name', /^(?:nombre(?:\s+completo)?|name)$/],
  ['phone', /^(?:telefono|tel|celular|cel|whatsapp|numero(?:\s+de\s+telefono)?)$/],
  ['email', /^(?:correo(?:\s+electronico)?|email|e\s*mail)$/],
  ['province', /^provincia$/],
  ['canton', /^canton$/],
  ['district', /^distrito$/],
  ['address', /^(?:direccion(?:\s+exacta)?(?:\s+con\s+senas)?|senas|otras\s+senas)$/],
]
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
/** A Costa Rica phone alone on its line (optional +506 / spaces / dashes). */
const PHONE_LINE_RE = /^\s*(?:\+?506[\s-]?)?([2-8]\d{3})[\s-]?(\d{4})\s*$/

function cleanPhone(value: string): string {
  const digits = value.replace(/\D/g, '').replace(/^506(?=\d{8}$)/, '')
  return /^[2-8]\d{7}$/.test(digits) ? digits : ''
}

/** Only labelled lines, a valid email, a phone alone on its line, and a run of lines that is a real location. */
export function labelledCustomerFields(customerTexts: string[]): PrefillCustomer {
  const out: PrefillCustomer = { ...EMPTY_PREFILL_CUSTOMER }
  const lines = customerTexts
    .flatMap((t) => t.split(/\r?\n/))
    .map((l) => l.trim().slice(0, MAX_LINE))
    .filter(Boolean)
    .slice(-MAX_LINES)
  for (const line of lines) {
    const m = line.match(/^[\s📍☎️🏠✉️🗺️•\-*]*([^:=]{2,40}?)\s*[:=]\s*(.+)$/u)
    if (m) {
      const label = fold(m[1]).replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
      const hit = LABELS.find(([, re]) => re.test(label))
      if (hit) {
        const value = m[2].trim().slice(0, 300)
        if (hit[0] === 'phone') out.phone = cleanPhone(value) || out.phone
        else if (hit[0] === 'email') out.email = value.match(EMAIL_RE)?.[0] || out.email
        else out[hit[0]] = value
        continue
      }
    }
    const email = !out.email && line.includes('@') ? line.match(EMAIL_RE)?.[0] : undefined
    if (email) out.email = email
    const phone = line.match(PHONE_LINE_RE)
    if (phone && !out.phone) out.phone = `${phone[1]}${phone[2]}`
  }
  if (!out.province && out.canton) {
    const labelled = normalizeLocation({ canton: out.canton, district: out.district })
    if (labelled.province) Object.assign(out, labelled)
  }
  if (!out.province) {
    const run = locationFromLines(lines)
    if (run.province) Object.assign(out, run)
  }
  return out
}

/** "San José / Moravia / San Vicente" on consecutive lines (or "Moravia, San José"): only names that really exist. */
function locationFromLines(lines: string[]): Pick<PrefillCustomer, 'province' | 'canton' | 'district'> {
  const parts = lines
    .flatMap((l) => l.split(','))
    .map((p) => p.trim())
    .filter((p) => p && p.length <= 40)
    .slice(0, 80)
  const same = (a: string, b: string) => locKey(a) === locKey(b)
  // A run that starts with the province ("San José / Moravia / San Vicente").
  for (let i = 0; i < parts.length; i++) {
    const loc = normalizeLocation({ province: parts[i], canton: parts[i + 1] || '', district: parts[i + 2] || '' })
    if (loc.province && loc.canton && same(loc.province, parts[i])) return loc
  }
  // Or with the canton ("Moravia, San Vicente"), when that canton exists in one province only.
  for (let i = 0; i < parts.length; i++) {
    const loc = normalizeLocation({ canton: parts[i], district: parts[i + 1] || '' })
    if (loc.canton && loc.district && same(loc.canton, parts[i])) return loc
  }
  return { province: '', canton: '', district: '' }
}

/**
 * Keep only real Costa Rica names (official spelling); a level that does not match is dropped with everything below it.
 * A canton name that exists in only one province fills that province.
 */
export function normalizeLocation(input: { province?: string; canton?: string; district?: string }): Pick<PrefillCustomer, 'province' | 'canton' | 'district'> {
  const pKey = locKey(input.province || '')
  const cKey = locKey(input.canton || '')
  let province = PROVINCE_BY_KEY.get(pKey)
  if (!province && cKey) {
    const owners = CANTON_OWNERS.get(cKey)
    if (owners?.length === 1) province = owners[0]
  }
  if (!province) return { province: '', canton: '', district: '' }
  const canton = province.cantones.find((c) => locKey(c.nombre) === cKey)
  if (!canton) return { province: province.nombre, canton: '', district: '' }
  const dKey = locKey(input.district || '')
  const district = canton.distritos.find((d) => locKey(d) === dKey)
  return { province: province.nombre, canton: canton.nombre, district: district || '' }
}

function locKey(value: string): string {
  return value.length > 60 ? '' : fold(value).replace(/\s+/g, ' ').trim()
}
/** Built once (SecureDog H1): folded province / canton lookups. */
const PROVINCE_BY_KEY = new Map(costaRicaLocations.map((p) => [locKey(p.nombre), p]))
const CANTON_OWNERS = new Map<string, typeof costaRicaLocations>()
for (const p of costaRicaLocations) {
  for (const c of p.cantones) {
    const k = locKey(c.nombre)
    CANTON_OWNERS.set(k, [...(CANTON_OWNERS.get(k) ?? []), p])
  }
}

/** Final customer data: the AI's answer when it ran (empty stays empty), else the labelled fields; location validated. */
export function finalizeCustomer(source: PrefillCustomer): PrefillCustomer {
  const loc = normalizeLocation(source)
  return {
    name: source.name.trim().slice(0, 160),
    phone: cleanPhone(source.phone),
    email: source.email.match(EMAIL_RE)?.[0] || '',
    ...loc,
    address: source.address.trim().slice(0, 600),
  }
}

// ── Products ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The product's identifying words: its name without generic words ("GLP Patch" → ["glp"]). */
export function productWords(name: string): string[] {
  return tokens(name).filter((w) => !GENERIC_WORDS.has(w))
}

function hasWord(msgTokens: string[], word: string): boolean {
  // "glp1" / "glp 1" still name the GLP patch. String checks only (no regex per token — SecureDog H1).
  const lettersOnly = /^[a-z]+$/.test(word)
  return msgTokens.some((t) => {
    if (t === word) return true
    if (!lettersOnly || !t.startsWith(word)) return false
    const rest = t.slice(word.length)
    return rest.length > 0 && rest.length <= 2 && /^\d+$/.test(rest)
  })
}

function mentions(msgTokens: string[], squashed: string, words: string[]): boolean {
  if (!words.length) return false
  if (words.every((w) => hasWord(msgTokens, w))) return true
  // "SleepingPatches" written as "sleeping patches".
  return words.length === 1 && words[0].length >= 8 && squashed.includes(words[0])
}

function quantityIn(msgTokens: string[], firstWord: string): number {
  const text = msgTokens.join(' ')
  const w = firstWord.replace(/[^a-z0-9]/g, '')
  const numbers = `\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')}`
  const before = new RegExp(`(?:^|\\s)(${numbers})\\s+(?:x\\s+)?(?:(?:paquetes?|unidades?|parches?|patch(?:es)?|cajas?)\\s+)?(?:(?:de|del)\\s+)?(?:(?:el|la|los|las)\\s+)?${w}(?:\\d{0,2})(?:\\s|$)`)
  const after = new RegExp(`(?:^|\\s)${w}\\d{0,2}(?:\\s\\d{1,2})?\\s+(?:x\\s*|x|por\\s+)(\\d{1,2})(?:\\s|$)`)
  const afterTight = new RegExp(`(?:^|\\s)${w}\\d{0,2}(?:\\s\\d{1,2})?\\s+x(\\d{1,2})(?:\\s|$)`)
  const raw = text.match(before)?.[1] ?? text.match(afterTight)?.[1] ?? text.match(after)?.[1]
  if (!raw) return 1
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? 1
  return n >= 1 && n <= 20 ? n : 1
}

/**
 * Products the CUSTOMER named (the store's own catalog list is never read). Whole words; the longest name wins inside a
 * message ("bucal deepsleep" is the Bucal, not also a "DeepSleep" item); the latest message that names it sets the
 * quantity ("3 de glp" then "mejor solo 1 de glp" → 1).
 */
export function matchPrefillProducts(
  items: Array<{ id: string; name: string; category: string; sellingPrice: number }>,
  customerTexts: string[],
): PrefillProduct[] {
  const keyed = items.map((item) => ({ item, words: productWords(item.name) })).filter((k) => k.words.length > 0 && k.words.join('').length >= 3)
  const found = new Map<string, PrefillProduct>()
  for (const text of customerTexts) {
    const msgTokens = tokens(text)
    const squashed = msgTokens.join('')
    const hits = keyed.filter((k) => mentions(msgTokens, squashed, k.words))
    const kept = hits.filter((k) => !hits.some((o) => o !== k && o.words.length > k.words.length && k.words.every((w) => o.words.includes(w))))
    for (const { item, words } of kept) {
      found.set(item.id, {
        id: item.id,
        name: item.name.trim(),
        type: item.name.trim(),
        baseCost: Number(item.sellingPrice) || 0,
        cantidad: quantityIn(msgTokens, words[0]),
      })
    }
  }
  return [...found.values()]
}

// ── Delivery / payment ─────────────────────────────────────────────────────────────────────────────────────────────

const PICKUP_RE = /\bretiro\b|\bretirar(lo|la)?\b|\brecoger(lo|la)?\b|\bpaso\s+a\s+(recoger|retirar)/
/** "envío" as a noun only ("te envío el comprobante" is a verb). */
const DELIVERY_RE =
  /\b(el|con|un|hacen|hacer|por|para)\s+envio\b|\benvio\s+a\s+(domicilio|la\s+casa|mi\s+casa)\b|\ba\s+domicilio\b|\bque\s+me\s+lo\s+(envien|manden|traigan)\b|\bme\s+lo\s+(envian|mandan|traen)\b|\bcontra\s*entrega\b|^\s*envio\s*[.!]?\s*$/
const COD_RE = /\bcontra\s*entrega\b|\bpago\s+al\s+(recibir|mensajero)\b/

/** Pickup vs delivery and contra entrega, from what the customer chose (latest mention wins). */
export function detectOrderChoices(customerTexts: string[]): OrderPrefillChoices {
  let orderType: OrderPrefillChoices['orderType'] = null
  let paymentChoice: OrderPrefillChoices['paymentChoice'] = null
  for (const raw of customerTexts) {
    const t = fold(raw)
    // A question ("¿cuánto cuesta el envío?", "¿hacen contra entrega?") is not a choice.
    if (/\?\s*$/.test(t)) continue
    if (PICKUP_RE.test(t)) orderType = 'RA'
    if (DELIVERY_RE.test(t)) orderType = 'EA'
    if (COD_RE.test(t)) paymentChoice = 'contra_entrega'
  }
  return { orderType, paymentChoice }
}
