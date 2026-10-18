/**
 * Out-of-stock switch (SQL 055, Rafael 2026-10-18) — pure rules shared by the live turn, Probar, the tool and the UI
 * route. A product is sold out when the owner switched "Agotado" on, or (only for a store that tracks stock) when its
 * stock is 0. The agent never offers or closes a sold-out product, never quotes its price, and gives a "vuelve aprox."
 * only when the owner wrote one. Dates are Costa Rica dates.
 */
import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'

export const BACK_NOTE_MAX = 60
export const MAX_BACK_DAYS = 180
const CR_TZ = 'America/Costa_Rica'
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export type AvailabilityRow = { soldOut: boolean; backDate: string | null; backNote: string | null }
/** What the agent is told about one sold-out product (never its price). */
export type SoldOutItem = { name: string; back: string | null }
/** Sold-out products of this agent + the names it may still sell (the reply checks use both). */
export type StockGuard = { soldOut: SoldOutItem[]; inStockNames: string[]; focus: boolean }

/** Today in Costa Rica as YYYY-MM-DD. */
export function crToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CR_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date YYYY-MM-DD, or null. */
export function parseYmd(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = YMD_RE.exec(raw.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return m[0]
}

/** Owner input check: from today to 180 days out (Costa Rica). 'invalid' = reject the save. */
export function checkBackDate(raw: unknown, now: Date = new Date()): string | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null
  const ymd = parseYmd(raw)
  if (!ymd) return 'invalid'
  const diff = dayNumber(ymd) - dayNumber(crToday(now))
  return diff < 0 || diff > MAX_BACK_DAYS ? 'invalid' : ymd
}

/** A date that already passed (Costa Rica) is expired: the agent says there is no date yet. */
export function backDateExpired(ymd: string, now: Date = new Date()): boolean {
  return dayNumber(ymd) < dayNumber(crToday(now))
}

export function formatBackDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${d} de ${MONTHS[m - 1]}`
}

/**
 * The owner's short note ("la próxima semana") is DATA shown to the model: one line, no digits (a date goes in the
 * date field), no amounts, links, markers or brackets. Applied on write AND on read.
 */
export function sanitizeBackNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = stripFormatChars(raw.normalize('NFKC'))
    .replace(/https?:\/\/\S+|www\.\S+|\b[\w-]+\.(?:com|net|org|cr|shop|store|io|co)\b\S*/gi, ' ')
    .replace(/[\p{N}₡$€%@#*_~`|\\/<>[\]{}()"«»“”=+^]/gu, ' ')
    .replace(/\b(?:betsy|sistema|system|instrucci\w*|reglas?|ignor\w*|prompt|pago|sinpe|iban|cuenta)\b/giu, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!¡?¿-]+|[\s,;:-]+$/g, '')
    .trim()
    .slice(0, BACK_NOTE_MAX)
    .trim()
  return t.length >= 3 ? t : null
}

/** "vuelve aprox. el 25 de octubre" / "vuelve aprox. la próxima semana" / null (no date: the agent must not give one). */
export function backText(row: AvailabilityRow | null | undefined, now: Date = new Date()): string | null {
  if (!row) return null
  const ymd = row.backDate ? parseYmd(row.backDate) : null
  if (row.backDate) return ymd && !backDateExpired(ymd, now) ? `vuelve aprox. el ${formatBackDate(ymd)}` : null
  const note = sanitizeBackNote(row.backNote)
  return note ? `vuelve aprox. ${note}` : null
}

/** A store "tracks stock" when at least one of the agent's products has stock > 0 (otherwise 0 is just the default). */
export function tracksStock(items: Array<{ currentStock: number }>): boolean {
  return items.some((i) => Number(i.currentStock) > 0)
}

export function effectiveSoldOut(item: { currentStock: number }, row: AvailabilityRow | null | undefined, tracks: boolean): boolean {
  return Boolean(row?.soldOut) || (tracks && Number(item.currentStock) <= 0)
}

export function soldOutLabel(back: string | null): string {
  return `AGOTADO (no lo ofrezcas ni tomes el pedido; ${back ? back : 'sin fecha de regreso: no des fecha'})`
}

type StockItem = { id: string; name: string; currentStock: unknown; isActive?: boolean }

/**
 * Sold-out view of an agent's products: which are sold out (with the owner's "vuelve aprox."), which names are still
 * on sale. The stock-0 rule applies only when the store tracks stock (some product has stock > 0).
 */
export function buildStockGuard(items: StockItem[], rows: Map<string, AvailabilityRow>, now: Date = new Date()): {
  guard: Omit<StockGuard, 'focus'>
  soldOutIds: Set<string>
  backById: Map<string, string | null>
  staleBackIds: string[]
} {
  const active = items.filter((i) => i.isActive !== false).map((i) => ({ ...i, currentStock: Number(i.currentStock) || 0 }))
  const tracks = tracksStock(active)
  const soldOutIds = new Set<string>()
  const backById = new Map<string, string | null>()
  const soldOut: SoldOutItem[] = []
  const inStock: string[] = []
  for (const i of active) {
    const row = rows.get(i.id)
    if (effectiveSoldOut(i, row, tracks)) {
      const back = backText(row, now)
      soldOutIds.add(i.id)
      backById.set(i.id, back)
      soldOut.push({ name: i.name, back })
    } else {
      inStock.push(i.name)
    }
  }
  // Same name on sale under another id (a duplicate row): that name is not sold out.
  const onSale = new Set(inStock.map(normalizeName))
  return {
    guard: { soldOut: soldOut.filter((s) => !onSale.has(normalizeName(s.name))).slice(0, 60), inStockNames: inStock.slice(0, 200) },
    soldOutIds,
    backById,
    staleBackIds: staleBackIds(items, rows),
  }
}

/**
 * A "vuelve aprox." written for a product sold out by stock 0 (no manual switch) is spent once stock is back: it must
 * not come back with the next outage (Verifier r1 #2). Those rows are cleared by the server.
 */
export function staleBackIds(items: StockItem[], rows: Map<string, AvailabilityRow>): string[] {
  return items
    .filter((i) => {
      const row = rows.get(i.id)
      return Boolean(row && !row.soldOut && (row.backDate || row.backNote) && Number(i.currentStock) > 0)
    })
    .map((i) => i.id)
}

type ToolRow = { name: string; sku: string | null; category: string | null; currentStock: unknown; minStock: unknown; sellingPrice: unknown }

/** search_inventory row of a product on sale (same fields as before SQL 055). */
export function onSaleToolItem(r: ToolRow) {
  const stock = Number(r.currentStock) || 0
  return {
    name: r.name,
    sku: r.sku,
    category: r.category,
    currentStock: r.currentStock,
    sellingPrice: r.sellingPrice,
    stockLabel: stock > 0 && stock < (Number(r.minStock) || 0) ? 'pocas unidades' : 'disponible',
  }
}

/** search_inventory row of a sold-out product: no price, stock 0, the owner's "vuelve aprox." or none. */
export function soldOutToolItem(r: ToolRow, back: string | null) {
  return { name: r.name, sku: r.sku, category: r.category, currentStock: 0, soldOut: true, stockLabel: soldOutLabel(back), vuelveAprox: back }
}

// ---------------------------------------------------------------- reply checks

export function normalizeName(s: string): string {
  return stripFormatChars(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Words that never identify one product on their own. */
const GENERIC = new Set([
  'patch', 'patches', 'parche', 'parches', 'kit', 'kits', 'combo', 'pack', 'paquete', 'caja', 'unidad', 'unidades',
  'color', 'talla', 'size', 'grande', 'mediano', 'pequeno', 'negro', 'blanco', 'para', 'con', 'sin', 'de', 'del', 'the',
])

const hasWords = (hay: string, needle: string) => needle.length > 0 && ` ${hay} `.includes(` ${needle} `)

/**
 * The text names this product: its whole name, or a word of it (4+ letters) that no product still on sale shares
 * ("el Focus" = "Focus Patch" when "Energy Patch" is the other one; "arnés forge" never singles out one size).
 */
export function mentionsProduct(text: string, name: string, otherNames: string[]): boolean {
  const t = normalizeName(text)
  const n = normalizeName(name)
  if (!n) return false
  if (hasWords(t, n)) return true
  const others = otherNames.map(normalizeName)
  return n
    .split(' ')
    .filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\p{N}+$/u.test(w))
    .some((w) => hasWords(t, w) && !others.some((o) => hasWords(o, w)))
}

/** A combo naming a sold-out product: whole-name match only (a word match would drop "Combo Calma" on a near miss). */
export function bundleHasSoldOut(bundleName: string, soldOutNames: string[]): boolean {
  const b = normalizeName(bundleName)
  return soldOutNames.some((n) => hasWords(b, normalizeName(n)))
}

/** A chat message as the focus walk reads it (newest first): the customer's and the store's. */
export type FocusMessage = { direction: 'inbound' | 'outbound'; content: string }

/**
 * The customer is (still) asking for a sold-out product. Walks the chat newest first: a customer message naming a
 * product decides (sold out → focus, on sale → none); a store message that offered a product on sale ends it (the
 * customer's later "sí, lo quiero" is for that alternative — Verifier r1 #1). Only the last 8 messages count.
 */
export function soldOutFocus(newestFirst: FocusMessage[], guard: Pick<StockGuard, 'soldOut' | 'inStockNames'>): string | null {
  if (guard.soldOut.length === 0) return null
  const soldNames = guard.soldOut.map((s) => s.name)
  for (const m of newestFirst.slice(0, 8)) {
    const text = m.content || ''
    const inStock = guard.inStockNames.some((n) => mentionsProduct(text, n, soldNames))
    if (inStock) return null
    if (m.direction === 'outbound') continue
    const sold = guard.soldOut.find((s) => mentionsProduct(text, s.name, guard.inStockNames))
    if (sold) return sold.name
  }
  return null
}

/** The reply closes a sale: asks for the order data or how to pay, or carries payment details / a reservation. */
const CLOSE_ASK_RE =
  /\[\[\s*(?:PAGO_|DATOS_PAGO)|c[oó]mo\s+(?:prefer\p{L}*|quer[eé]s|quiere|vas\s+a|va\s+a|pod[eé]s|puede)\s+pagar|m[eé]todo\s+de\s+pago|forma\s+de\s+pago|nombre\s+completo|direcci[oó]n\s+exacta|(?:p[aá]same|m[aá]ndame|env[ií]ame|ocupo|necesito)\s+(?:tus|los|unos)\s+datos|datos\s+(?:del|para\s+el)\s+(?:pedido|env[ií]o)|te\s+lo\s+(?:aparto|reservo|separo|anoto)|(?:sinpe|transferencia)\s+al\s/iu

/** Restock words that mean nothing else ("reponemos", "reingresa", "nuevo lote"). */
const RESTOCK_STRONG_RE =
  /\brep[oó]n(?:e|en|emos|dr[aá]n?|dremos|go|ga|gan)\b|\breingres\p{L}*|\b(?:nuevo|pr[oó]ximo)\s+(?:ingreso|lote)\b|\bvuelv\p{L}*\s+(?:a\s+(?:haber|entrar|ingresar)\b|aprox)|\b(?:hay|habr[aá])\s+(?:de\s+nuevo|otra\s+vez|nuevamente)/iu
/**
 * "vuelve a haber / entrar", "vuelve aprox.", "vuelve el 25", "llega de nuevo": restock talk only next to stock words or
 * a sold-out product's name ("la encargada vuelve en la tarde" and "el repuesto te llega mañana" are not restocks).
 */
const RESTOCK_WEAK_RE =
  /\bvuelv\p{L}*\s+(?:a\s+(?:haber|entrar|estar|llegar|tener)|aprox|(?:el|para\s+el)\s+\d|(?:la|esta|el)\s+(?:pr[oó]xim[ao]|otr[ao]|siguiente)\s+(?:semana|mes)|a\s+(?:finales|inicios|mediados|principios))|\b(?:llega|llegan|llegar[aá]n?|entra|entran|entrar[aá]n?|hay|habr[aá])\s+(?:de\s+nuevo|otra\s+vez|nuevamente)/iu
const STOCK_WORD_RE = /agotad|\bstock\b|inventario|disponib|existencias/iu

const DATEISH_RE = new RegExp(
  [
    String.raw`\b\d{1,2}\s+de\s+(?:${MONTHS.join('|')})\b`,
    String.raw`\b(?:el|para\s+el|del|al)\s+\d{1,2}\b`,
    String.raw`\b(?:el|este|pr[oó]ximo|para\s+el)\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b`,
    String.raw`\b(?:esta|la\s+otra|la\s+pr[oó]xima|la\s+siguiente|en\s+una|en\s+dos|en\s+\d+)\s+semanas?\b`,
    String.raw`\b(?:este|el\s+otro|el\s+pr[oó]ximo|el\s+siguiente|en\s+un|en\s+\d+)\s+mes(?:es)?\b`,
    String.raw`\ben\s+(?:\d+|un|una|dos|tres|pocos|unos)\s+d[ií]as\b`,
    String.raw`\b(?:pasado\s+)?ma[nñ]ana\b`,
    String.raw`\b(?:a\s+)?(?:finales|inicios|principios|mediados)\s+de\s+(?:mes|semana|${MONTHS.join('|')})\b`,
    String.raw`\b(?:${MONTHS.join('|')})\b`,
  ].join('|'),
  'gi',
)

/**
 * Deterministic stock checks on a reply (live turn + Probar):
 * - sold_out_offered: the reply closes a sale (order data / how to pay / payment details / "te lo aparto") for a
 *   sold-out product — the customer is asking for one (focus) or the reply names one — and names nothing on sale.
 * - restock_date_invented: the reply talks about a restock with a date or time that is not the owner's own
 *   "vuelve aprox." text (no text configured = no date at all).
 */
export function stockProblems(text: string, guard: StockGuard | null | undefined): string[] {
  if (!guard || guard.soldOut.length === 0) return []
  const out: string[] = []
  const t = text || ''
  const soldNames = guard.soldOut.map((s) => s.name)
  const namesInStock = guard.inStockNames.some((n) => mentionsProduct(t, n, soldNames))
  const namesSoldOut = guard.soldOut.some((s) => mentionsProduct(t, s.name, guard.inStockNames))
  if (CLOSE_ASK_RE.test(t) && !namesInStock && (guard.focus || namesSoldOut)) out.push('sold_out_offered')
  const restock = RESTOCK_STRONG_RE.test(t) || (RESTOCK_WEAK_RE.test(t) && (STOCK_WORD_RE.test(t) || namesSoldOut))
  if (restock) {
    const allowed = guard.soldOut.map((s) => normalizeName(s.back || '')).filter(Boolean)
    const dates = [...t.matchAll(DATEISH_RE)].map((m) => normalizeName(m[0]).replace(/^(?:para el|el|del|al|a)\s+/, ''))
    if (dates.some((d) => !allowed.some((a) => hasWords(a, d)))) out.push('restock_date_invented')
  }
  return out
}
