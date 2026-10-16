/**
 * Mapa de conocimiento (Rafael 2026-10-16): one standard template for every inbox agent — per product (precio,
 * ingredientes, uso, frecuencia, qué esperar, advertencias) and per store (envío, pago, contra entrega, retiro,
 * devoluciones, horario) — measured against what the agent ACTUALLY sees in its prompt:
 * - knowledge that does not fit the budget (budgetKnowledgeSlice) is "escrito pero no entra" and counts as missing;
 * - saved replies count only as the prompt catalog shows them (guideCatalogRows: filter, order, 300-char bodies);
 * - shipping comes from Config › Métodos de envío when the business has methods (as the live sales context does),
 *   brand facts only as the fallback; free shipping only via combos / promo (freeOver never reaches the agent);
 *   hours only via the hours text (the windows are not in the prompt).
 * Pure; the server builds the input (knowledge-map-server.ts).
 */
import type { BrandFacts } from '@/lib/soft-ai/brand-facts'
import { colonAmountsIn } from '@/lib/soft-ai/agent-tuning-core'
import { productCoreName } from '@/lib/soft-ai/knowledge-coverage'
import { redactPiiText, redactSensitiveForProvider } from '@/lib/soft-ai/llm/redact'

export type MapFieldStatus = 'ok' | 'hidden' | 'missing' | 'na'
/** Where the owner fixes a field: knowledge text, or the structured setting it comes from. */
export type MapFix = 'answer' | 'inventory' | 'brand_facts' | 'shipping_methods' | 'sales_rules'

export type MapField = {
  key: string
  label: string
  status: MapFieldStatus
  /** Source name ("PatchHouse · Productos", "inventario", "métodos de envío", "general · …"), or null when missing. */
  source: string | null
  /** The text that matched (≤160 chars), so the owner can judge; never a payment number. */
  snippet: string | null
  fix: MapFix
}

export type MapProduct = { id: string; name: string; fields: MapField[] }
export type MapConflict = { key: string; label: string; detail: string }
export type MapLane = { key: 'brand_policy' | 'faq' | 'corrections'; label: string; used: number; written: number; budget: number }

export type KnowledgeMap = {
  products: MapProduct[]
  store: MapField[]
  conflicts: MapConflict[]
  lanes: MapLane[]
  filled: number
  total: number
  /** filled / total, rounded; 0 when there is nothing to measure. Counts are shown first ("18 de 24 · 75 %"). */
  percent: number
  /** Documents / replies over the size caps that were not (fully) read. */
  notMeasured: number
}

export type KnowledgeDocInput = {
  name: string
  kind: string
  body: string
  /** false = approved and bound, but over the prompt budget: the agent never sees it. */
  visible: boolean
  lane: MapLane['key']
}

export type MapInput = {
  products: Array<{ id: string; name: string; price: number }>
  docs: KnowledgeDocInput[]
  /** Saved replies exactly as the prompt catalog shows them (guideCatalogRows). */
  catalogReplies: Array<{ title: string; body: string }>
  brandFacts: BrandFacts
  /** Config › Métodos de envío offered by this agent (the live source of shipping when present). */
  shippingMethods: Array<{ name: string; price: number; allowsCod: boolean }>
  /** Combos that include shipping (salesRules.bundles), e.g. "Pack 2 bolsas". */
  freeShippingBundles?: string[]
  /** An active promo makes shipping free. */
  promoFreeShipping?: boolean
  budgets: Record<MapLane['key'], number>
  /** Template keys the owner marked as not applicable ("product.ingredients", "store.pickup"). */
  notApplicable?: string[]
}

export const PRODUCT_FIELDS = [
  { key: 'price', label: 'Precio' },
  { key: 'ingredients', label: 'Ingredientes' },
  { key: 'usage', label: 'Cómo se usa' },
  { key: 'frequency', label: 'Cada cuánto / cuánto dura' },
  { key: 'results', label: 'Qué esperar' },
  { key: 'warnings', label: 'Advertencias' },
] as const

export const STORE_FIELDS = [
  { key: 'shipping_cost', label: 'Costo de envío' },
  { key: 'shipping_time', label: 'Tiempo de entrega' },
  { key: 'free_shipping', label: 'Envío gratis' },
  { key: 'payment', label: 'Formas de pago' },
  { key: 'cod', label: 'Contra entrega' },
  { key: 'pickup', label: 'Retiro' },
  { key: 'returns', label: 'Cambios y devoluciones' },
  { key: 'hours', label: 'Horario' },
] as const

// Strict on purpose (verifier 2026-10-16): store words like "lleva 2 días", "la promo aplica", "varias formas",
// "para consultas", "cualquier cambio" or "formulario" must never count as product knowledge. Folded text (no accents).
const TEXT_TOPICS: Record<string, RegExp> = {
  ingredients: /\bingredientes?\b|\bcontiene\b|\bformula\b|\bcomposicion\b|\bcomponentes?\b/,
  usage: /\bse usan?\b|\bcomo se (usan?|aplica|pone|coloca)\b|\bmodo de uso\b|\bse aplican?\b|\baplicar(lo|la|las|los)?\b|\bse pegan?\b|\bpegal[oa]\b|\bse colocan?\b|\bcolocal[oa]s?\b|\bdespeg/,
  // Bounded digit runs (SecureDog INT-127): \d+ before a word backtracks quadratically on long digit runs.
  frequency: /\bal dia\b(?! siguiente)|\bcada dia\b|\bdiari[oa]s?\b|\btodos los dias\b|\bpor noche\b|\bcada noche\b|\bvez al dia\b|(?<!\d)\d{1,4} ?(horas|minutos)\b|\bpor uso\b/,
  results: /\bresultados?\b|\bse notan?\b|\bcada (persona|organismo) responde\b|\bno prometemos\b/,
  warnings: /\bembaraz|\blactancia\b|\bmedico\b|\bdentista\b|\bmenores de (edad|\d{1,2} anos)\b|\balergi|\birrita/,
  returns: /\bdevoluci|\breembols|\bgarantia\b|\bdanad[oa]s?\b|\bincomplet[oa]s?\b|\bcambios y devoluciones\b/,
  delivery: /(?<!\d)\d{1,3} ?a ?\d{1,3} ?dias\b|\bdias habiles\b/,
}
/** Topics that may count from general text (paragraphs naming no product). Ingredients are always per product. */
const GENERAL_OK = new Set(['usage', 'frequency', 'results', 'warnings', 'returns', 'delivery'])

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Hard caps on what one map measures (SecureDog INT-127); the rest is reported as not measured. */
export const MAP_MAX_DOCS = 60
export const MAP_MAX_CHARS = 200_000
export const MAP_MAX_REPLIES = 300
const WINDOWS_PER_DOC = 10
/** Product / method names are cut to this in the map and in name matching (SecureDog INT-129 / INT-130). */
export const MAP_NAME_MAX = 120

/** Masks anything payment- or ID-looking (cards, IBAN, IDs, phones, emails, SINPE, digit runs with any separator). */
export function maskMapText(raw: string): string {
  return redactPiiText(redactSensitiveForProvider(raw.slice(0, 400)))
    .replace(/[A-Z]{2}\d{2}(?:[\s.\-_/–]?\d{2,4}){3,}/gi, '…')
    .replace(/\d[\d\s.\-_/–]{6,}\d/g, '…')
    .trim()
}

/** A short snippet around a match (≤160 chars), masked (SecureDog DATA-58): never a payment number. */
function snippetAt(original: string, index: number): string {
  const start = Math.max(0, original.lastIndexOf('\n', index) + 1, index - 80)
  return maskMapText(original.slice(start, start + 160).split('\n')[0])
}

/** A document prepared once: folded text and its paragraphs (offsets into the original). */
type Doc = { name: string; body: string; folded: string; paras: Array<{ folded: string; offset: number }> }
type Hit = { source: string; snippet: string }
type Mention = { index: number; core: string }

function prepareDoc(name: string, body: string): Doc {
  const folded = fold(body)
  const paras: Doc['paras'] = []
  const re = /\n\s*\n/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(folded))) {
    paras.push({ folded: folded.slice(last, m.index), offset: last })
    last = m.index + m[0].length
  }
  paras.push({ folded: folded.slice(last), offset: last })
  return { name, body, folded, paras }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * ONE regex for every product name (longest first, so "focus plus" wins over "focus"): all mentions of all products in
 * a document are found in a single pass (SecureDog INT-127 round 2: no products × products scans).
 */
function allCoresRe(cores: string[]): RegExp | null {
  const unique = [...new Set(cores.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!unique.length) return null
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${unique.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
}

/** Paragraphs that name no product: text that applies to all of them ("USO (igual para todos): …"). */
/** Sentences about the store (shipping, orders, payment, promos) never count as product knowledge. */
const STORE_SENTENCE_RE = /\b(envio|envios|enviamos|envian|entrega|entregamos|entregas|pedido|pedidos|pago|pagos|pagar|promo|promocion|descuento|direccion|compra|compras|comprar|precio|precios|retiro|despacho|mensajer|correos|sinpe|tarjeta|factura|horario|cupon|atend|respond|mensaje|whatsapp|escrib|condicion|termino)\w*|\bconsultas?\b/

type Ctx = {
  visible: Doc[]
  hidden: Doc[]
  allCores: RegExp | null
  mentions: Map<Doc, Mention[]>
  windows: Map<string, Array<{ start: number; text: string }>>
  sections: Map<Doc, Array<{ start: number; end: number; core: string }>>
  general: Map<Doc, boolean[]>
  generalHits: Map<string, Hit | null>
  docIndex: Map<Doc, number>
}

/** Every product mention in a document (one pass, cached). */
function mentionsOf(ctx: Ctx, d: Doc): Mention[] {
  const cached = ctx.mentions.get(d)
  if (cached) return cached
  const out: Mention[] = []
  if (ctx.allCores) {
    const re = new RegExp(ctx.allCores.source, 'gu')
    let m: RegExpExecArray | null
    while ((m = re.exec(d.folded))) out.push({ index: m.index, core: m[0] })
  }
  ctx.mentions.set(d, out)
  return out
}

/** A mention at the start of its line (after spaces, a bullet, a number or a heading mark): it starts a new section. */
function startsLine(folded: string, index: number): boolean {
  const lineStart = folded.lastIndexOf('\n', index - 1) + 1
  return /^[\s\-•*–#>\d.):]*$/.test(folded.slice(lineStart, index))
}

/**
 * Every product section of a document, in one pass over the mentions (verifier round 3): a section opens at a mention
 * that starts a line, or at a mid-line mention outside any section ("¿El Focus Patch sirve…?"); it ends at the next blank
 * line, 700 chars, or the next LINE-START mention of a different product ("Focus: …\nEnergy: contiene cafeína" is Energy's
 * fact). A mid-line mention inside a section ("ideal para combinar con el Energy Patch") neither ends it nor opens one.
 */
function sectionsOf(ctx: Ctx, d: Doc): Array<{ start: number; end: number; core: string }> {
  const cached = ctx.sections.get(d)
  if (cached) return cached
  const out: Array<{ start: number; end: number; core: string }> = []
  let cur: { start: number; end: number; core: string } | null = null
  for (const m of mentionsOf(ctx, d)) {
    const lineStart = startsLine(d.folded, m.index)
    if (cur && m.index < cur.end) {
      if (m.core === cur.core || !lineStart) continue
      cur.end = m.index
    }
    let end = Math.min(d.folded.length, m.index + 700)
    const blank = d.folded.slice(m.index, end).search(/\n\s*\n/)
    if (blank > 0) end = m.index + blank
    cur = { start: m.index, end, core: m.core }
    out.push(cur)
  }
  ctx.sections.set(d, out)
  return out
}

/** The product's sections in one document (≤WINDOWS_PER_DOC), cached per (document, product), reused for every topic. */
function windowsFor(ctx: Ctx, d: Doc, core: string): Array<{ start: number; text: string }> {
  const key = `${ctx.docIndex.get(d) ?? -1}\u0000${core}`
  const cached = ctx.windows.get(key)
  if (cached) return cached
  const out = sectionsOf(ctx, d)
    .filter((s) => s.core === core)
    .slice(0, WINDOWS_PER_DOC)
    .map((s) => ({ start: s.start, text: d.folded.slice(s.start, s.end) }))
  ctx.windows.set(key, out)
  return out
}

/** Which paragraphs of a document name no product (from the cached mentions). */
function generalParasOf(ctx: Ctx, d: Doc): boolean[] {
  const cached = ctx.general.get(d)
  if (cached) return cached
  const mentions = mentionsOf(ctx, d)
  const flags = d.paras.map((p) => !mentions.some((m) => m.index >= p.offset && m.index < p.offset + p.folded.length))
  ctx.general.set(d, flags)
  return flags
}

/**
 * General text for a topic in one document — the same for every product, so cached per (document, topic, kind).
 * Product fields: only paragraphs naming no product, sentence by sentence, skipping store sentences.
 */
function generalHit(ctx: Ctx, d: Doc, topicKey: string, topic: RegExp, productField: boolean): Hit | null {
  const key = `${ctx.docIndex.get(d) ?? -1}\u0000${topicKey}\u0000${productField ? 'p' : 's'}`
  if (ctx.generalHits.has(key)) return ctx.generalHits.get(key) ?? null
  let hit: Hit | null = null
  const flags = productField ? generalParasOf(ctx, d) : null
  outer: for (let i = 0; i < d.paras.length; i++) {
    if (flags && !flags[i]) continue
    const p = d.paras[i]
    if (!productField) {
      const m = topic.exec(p.folded)
      if (m) {
        hit = { source: `general · ${d.name}`, snippet: snippetAt(d.body, p.offset + m.index) }
        break
      }
      continue
    }
    const re = /[^.!?\n]+/g
    let sm: RegExpExecArray | null
    while ((sm = re.exec(p.folded))) {
      if (STORE_SENTENCE_RE.test(sm[0])) continue
      const m = topic.exec(sm[0])
      if (m) {
        hit = { source: `general · ${d.name}`, snippet: snippetAt(d.body, p.offset + sm.index + m.index) }
        break outer
      }
    }
  }
  ctx.generalHits.set(key, hit)
  return hit
}

function textField(key: string, label: string, topic: RegExp, core: string | null, ctx: Ctx): MapField {
  const general = GENERAL_OK.has(key)
  const productHit = (d: Doc): Hit | null => {
    if (!core) return null
    for (const w of windowsFor(ctx, d, core)) {
      const m = topic.exec(w.text)
      if (m) return { source: d.name, snippet: snippetAt(d.body, w.start + m.index) }
    }
    return null
  }
  // Order: the product's own visible text, its own hidden text, then general visible / general hidden. A hidden
  // product paragraph is never masked by an unrelated visible line.
  const tries: Array<{ docs: Doc[]; status: 'ok' | 'hidden'; find: (d: Doc) => Hit | null }> = []
  if (core) {
    tries.push({ docs: ctx.visible, status: 'ok', find: productHit })
    tries.push({ docs: ctx.hidden, status: 'hidden', find: productHit })
  }
  if (general || !core) {
    tries.push({ docs: ctx.visible, status: 'ok', find: (d) => generalHit(ctx, d, key, topic, Boolean(core)) })
    tries.push({ docs: ctx.hidden, status: 'hidden', find: (d) => generalHit(ctx, d, key, topic, Boolean(core)) })
  }
  for (const t of tries) {
    for (const d of t.docs) {
      const hit = t.find(d)
      if (hit) return { key, label, status: t.status, source: hit.source, snippet: hit.snippet, fix: 'answer' }
    }
  }
  return { key, label, status: 'missing', source: null, snippet: null, fix: 'answer' }
}

const structured = (key: string, label: string, ok: boolean, source: string, snippet: string | null, fix: MapFix): MapField =>
  ok ? { key, label, status: 'ok', source, snippet, fix } : { key, label, status: 'missing', source: null, snippet: null, fix }

const PAYMENT_LABELS: Record<string, string> = {
  sinpe: 'SINPE Móvil',
  transferencia: 'transferencia',
  tarjeta: 'tarjeta',
  efectivo: 'efectivo',
  contra_entrega: 'contra entrega',
}
const money = (n: number) => `₡${n.toLocaleString('es-CR')}`

function storeFields(input: MapInput, ctx: Ctx): MapField[] {
  const facts = input.brandFacts
  const ea = facts.shipping?.ea
  const methods = input.shippingMethods
  // Live rule (agent-sales-context): methods win; brand facts are only the fallback when there are none.
  const factCosts = [ea?.gamCost, ea?.outsideGamCost].filter((n): n is number => typeof n === 'number')
  const shippingCost = methods.length
    ? structured('shipping_cost', 'Costo de envío', true, 'métodos de envío', maskMapText(methods.slice(0, 3).map((m) => `${m.name.slice(0, MAP_NAME_MAX)} ${money(m.price)}`).join(' · ')), 'shipping_methods')
    : structured('shipping_cost', 'Costo de envío', Boolean(ea?.enabled) && factCosts.length > 0, 'datos del negocio', factCosts.map(money).join(' / ') || null, 'brand_facts')
  // Delivery time: only brand facts without methods reach the prompt; otherwise it has to be written.
  const shippingTime =
    !methods.length && ea?.etaText
      ? structured('shipping_time', 'Tiempo de entrega', true, 'datos del negocio', maskMapText(ea.etaText), 'brand_facts')
      : textField('shipping_time', 'Tiempo de entrega', TEXT_TOPICS.delivery, null, ctx)
  const free = input.freeShippingBundles ?? []
  const freeShipping = structured(
    'free_shipping',
    'Envío gratis',
    free.length > 0 || Boolean(input.promoFreeShipping),
    input.promoFreeShipping ? 'promoción' : 'combos',
    input.promoFreeShipping ? 'promoción con envío gratis' : free.length ? `incluido en: ${free.slice(0, 3).join(', ')}` : null,
    'sales_rules',
  )
  const methodsList = facts.payment?.methods ?? []
  const codFromMethods = methods.some((m) => m.allowsCod)
  const cod = methods.length
    ? structured('cod', 'Contra entrega', true, 'métodos de envío', codFromMethods ? 'sí (según el método de envío)' : 'no', 'shipping_methods')
    : structured('cod', 'Contra entrega', typeof facts.shipping?.contraEntrega?.enabled === 'boolean', 'datos del negocio', facts.shipping?.contraEntrega ? (facts.shipping.contraEntrega.enabled ? 'sí' : 'no') : null, 'brand_facts')
  const returnsFact = facts.returnsText ? structured('returns', 'Cambios y devoluciones', true, 'datos del negocio', maskMapText(facts.returnsText.slice(0, 160)), 'brand_facts') : null
  return [
    shippingCost,
    shippingTime,
    freeShipping,
    // Method labels only — never a SINPE number or IBAN.
    structured('payment', 'Formas de pago', methodsList.length > 0, 'datos del negocio', methodsList.map((m) => PAYMENT_LABELS[m] ?? m).join(', ') || null, 'brand_facts'),
    cod,
    structured('pickup', 'Retiro', typeof facts.shipping?.ra?.enabled === 'boolean', 'datos del negocio', facts.shipping?.ra ? (facts.shipping.ra.enabled ? 'sí' : 'no') : null, 'brand_facts'),
    returnsFact ?? textField('returns', 'Cambios y devoluciones', TEXT_TOPICS.returns, null, ctx),
    // The hours windows never reach the prompt; only the hours text does.
    structured('hours', 'Horario', Boolean(facts.hoursText), 'datos del negocio', facts.hoursText ? maskMapText(facts.hoursText) : null, 'brand_facts'),
  ]
}

/** Numbers that disagree with the structured facts (shown, never auto-fixed; they do not lower the %). */
export function findConflicts(input: Pick<MapInput, 'products' | 'brandFacts' | 'shippingMethods'> & { visible: Array<{ name: string; body: string }> }): MapConflict[] {
  const out: MapConflict[] = []
  const cores = input.products.map((p) => productCoreName(p.name.slice(0, MAP_NAME_MAX)))
  const all = allCoresRe(cores)
  const lines = input.visible.flatMap((d) =>
    d.body
      .split('\n')
      // "P: …" lines are customer questions (corrections), not the store's facts.
      .filter((line) => !/^\s*P:/i.test(line))
      .map((line) => {
        const folded = fold(line)
        const named = new Set<string>()
        if (all) for (const m of folded.matchAll(new RegExp(all.source, 'gu'))) named.add(m[0])
        return { doc: d.name, line, folded, named }
      }),
  )
  const ea = input.brandFacts.shipping?.ea
  const shippingAmounts = new Set(
    [...input.shippingMethods.map((m) => m.price), ea?.gamCost, ea?.outsideGamCost, ea?.freeOver].filter((n): n is number => typeof n === 'number'),
  )
  const BUNDLE_RE = /combo|pack|paquetes|cajas|bolsas|unidades|\bx\s*\d|\d\s*x\b|full house|trio|antes|ahora|descuento|oferta|promo/
  input.products.forEach((p, i) => {
    const core = cores[i]
    if (!core || !(p.price > 0)) return
    for (const l of lines) {
      // Only lines that name this product and no other one (a line naming two products quotes both).
      if (!l.named.has(core) || l.named.size > 1 || BUNDLE_RE.test(l.folded)) continue
      // Amounts after "envío" are shipping, not the product price.
      const beforeShipping = l.line.split(/env[ií]o/i)[0]
      const wrong = colonAmountsIn(beforeShipping).filter((a) => a >= 100 && a !== p.price && !shippingAmounts.has(a))
      if (wrong.length) {
        out.push({ key: `price:${p.id}`, label: `Precio de ${p.name.slice(0, MAP_NAME_MAX)}`, detail: `"${l.doc}" dice ${money(wrong[0])}; el inventario dice ${money(p.price)}.` })
        break
      }
    }
  })
  if (shippingAmounts.size) {
    for (const l of lines) {
      if (!/env[ií]o/i.test(l.line) || BUNDLE_RE.test(l.folded) || /caja|bolsa|paquete/.test(l.folded)) continue
      const afterShipping = l.line.split(/env[ií]o/i).slice(1).join(' ')
      const wrong = colonAmountsIn(afterShipping).filter((a) => a >= 100 && !shippingAmounts.has(a) && !input.products.some((p) => p.price === a))
      if (wrong.length) {
        out.push({ key: 'shipping_cost', label: 'Costo de envío', detail: `"${l.doc}" dice ${money(wrong[0])}; la configuración dice ${[...shippingAmounts].map(money).join(' / ')}.` })
        break
      }
    }
  }
  const eta = !input.shippingMethods.length && ea?.etaText ? fold(ea.etaText) : ''
  if (eta) {
    const etaRanges = new Set([...eta.matchAll(/(?<!\d)(\d{1,3}) ?a ?(\d{1,3})(?!\d)/g)].map((m) => `${m[1]}-${m[2]}`))
    for (const l of lines) {
      // Delivery days only on lines about shipping / delivery (not "respondemos en 1 a 2 días los reclamos").
      if (!/\b(envio|envios|entrega|llega|llegan|despacho)\b/.test(l.folded)) continue
      const bad = [...l.folded.matchAll(/(?<!\d)(\d{1,3}) ?a ?(\d{1,3}) ?dias/g)].map((m) => `${m[1]}-${m[2]}`).find((r) => etaRanges.size && !etaRanges.has(r))
      if (bad) {
        out.push({ key: 'shipping_time', label: 'Tiempo de entrega', detail: `"${l.doc}" dice ${bad.replace('-', ' a ')} días; la configuración dice "${maskMapText(ea?.etaText ?? "")}".` })
        break
      }
    }
  }
  return out
}

export function buildKnowledgeMap(input: MapInput): KnowledgeMap {
  const na = new Set(input.notApplicable ?? [])
  const facts = input.brandFacts
  // Extra facts are in the prompt ("Etiqueta: valor"): they count as visible knowledge.
  // Caps (INT-127): at most MAP_MAX_DOCS documents, MAP_MAX_REPLIES replies and MAP_MAX_CHARS characters are read.
  let budget = MAP_MAX_CHARS
  let notMeasured = 0
  const take = (name: string, body: string): Doc | null => {
    if (budget <= 0) {
      notMeasured += 1
      return null
    }
    const text = body.slice(0, budget)
    budget -= text.length
    if (text.length < body.length) notMeasured += 1
    return prepareDoc(name, text)
  }
  const docsIn = input.docs.slice(0, MAP_MAX_DOCS)
  const repliesIn = input.catalogReplies.slice(0, MAP_MAX_REPLIES)
  notMeasured += input.docs.length - docsIn.length + input.catalogReplies.length - repliesIn.length
  const visible: Doc[] = [
    ...docsIn.filter((d) => d.visible).map((d) => take(d.name, d.body)),
    ...repliesIn.map((r) => take(`respuesta guardada · ${r.title}`, `${r.title}\n${r.body}`)),
    // Extra facts are in the prompt ("Etiqueta: valor"): they count as visible knowledge.
    facts.extraFacts?.length ? take('datos del negocio', facts.extraFacts.map((f) => `${f.label}: ${f.value}`).join('\n\n')) : null,
  ].filter((d): d is Doc => d !== null)
  const hidden: Doc[] = docsIn.filter((d) => !d.visible).map((d) => take(d.name, d.body)).filter((d): d is Doc => d !== null)
  const cores = input.products.map((p) => productCoreName(p.name.slice(0, MAP_NAME_MAX)))
  const docIndex = new Map<Doc, number>([...visible, ...hidden].map((d, i) => [d, i]))
  const ctx: Ctx = { visible, hidden, allCores: allCoresRe(cores), mentions: new Map(), windows: new Map(), sections: new Map(), general: new Map(), generalHits: new Map(), docIndex }

  const products: MapProduct[] = input.products.map((p, i) => {
    const price: MapField =
      p.price > 0
        ? { key: 'price', label: 'Precio', status: 'ok', source: 'inventario', snippet: money(p.price), fix: 'inventory' }
        : { key: 'price', label: 'Precio', status: 'missing', source: null, snippet: null, fix: 'inventory' }
    const fields: MapField[] = [
      price,
      ...PRODUCT_FIELDS.filter((f) => f.key !== 'price').map((f) => textField(f.key, f.label, TEXT_TOPICS[f.key], cores[i] || null, ctx)),
    ].map((f): MapField => (na.has(`product.${f.key}`) ? { ...f, status: 'na' } : f))
    return { id: p.id, name: p.name.slice(0, MAP_NAME_MAX), fields }
  })
  const store = storeFields(input, ctx).map((f): MapField => (na.has(`store.${f.key}`) ? { ...f, status: 'na' } : f))

  const all = [...products.flatMap((p) => p.fields), ...store].filter((f) => f.status !== 'na')
  const filled = all.filter((f) => f.status === 'ok').length
  const lane = (key: MapLane['key'], label: string): MapLane => ({
    key,
    label,
    used: input.docs.filter((d) => d.lane === key && d.visible).reduce((n, d) => n + d.body.length, 0),
    written: input.docs.filter((d) => d.lane === key).reduce((n, d) => n + d.body.length, 0),
    budget: input.budgets[key],
  })
  return {
    products,
    store,
    conflicts: findConflicts({ products: input.products, brandFacts: facts, shippingMethods: input.shippingMethods, visible: visible.map((d) => ({ name: d.name, body: d.body })) }),
    lanes: [lane('brand_policy', 'Producto y políticas'), lane('faq', 'Preguntas frecuentes'), lane('corrections', 'Correcciones')],
    filled,
    total: all.length,
    percent: all.length ? Math.round((filled / all.length) * 100) : 0,
    notMeasured,
  }
}

/**
 * A gap counts as answered only when the agent can SEE an answer: a "P:" line with the same normalized question in a
 * visible document, or (weaker) every word of the question inside one visible paragraph. `normalize` = the tuning
 * normalizer (lowercase, no accents / punctuation).
 */
export function gapAnswered(question: string, visibleBodies: string[], normalize: (s: string) => string): boolean {
  const q = normalize(question)
  if (!q) return false
  const words = q.split(' ').filter((w) => w.length > 3)
  for (const body of visibleBodies) {
    for (const line of body.split('\n')) {
      const m = /^\s*P:\s*(.+)$/i.exec(line)
      if (m && normalize(m[1]) === q) return true
    }
    if (words.length >= 2) {
      for (const para of body.split(/\n\s*\n/)) {
        const p = ` ${normalize(para)} `
        if (words.every((w) => p.includes(` ${w} `))) return true
      }
    }
  }
  return false
}
