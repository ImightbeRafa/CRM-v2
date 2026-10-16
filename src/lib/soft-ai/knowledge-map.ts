/**
 * Mapa de conocimiento (Rafael 2026-10-16): one standard template for every inbox agent — per product (precio,
 * ingredientes, uso, frecuencia, qué esperar, advertencias) and per store (envío, pago, contra entrega, retiro,
 * devoluciones, horario) — measured against what the agent ACTUALLY sees: knowledge that does not fit the prompt
 * budget (budgetKnowledgeSlice) is "escrito pero no entra" and counts as missing. Pure; the server builds the input
 * (knowledge-map-server.ts). Facts that live in structured settings (price, shipping, payment, hours) are read from
 * there, never from free text: duplicating them in text is what creates conflicts.
 */
import type { BrandFacts } from '@/lib/soft-ai/brand-facts'
import { colonAmountsIn } from '@/lib/soft-ai/agent-tuning-core'
import { productCoreName } from '@/lib/soft-ai/knowledge-coverage'

export type MapFieldStatus = 'ok' | 'hidden' | 'missing' | 'na'
/** Where the owner fixes a field: the map's answer box, or the structured setting it comes from. */
export type MapFix = 'answer' | 'inventory' | 'brand_facts' | 'hours'

export type MapField = {
  key: string
  label: string
  status: MapFieldStatus
  /** Source name ("PatchHouse · Productos", "inventario", "configuración", "general · …"), or null when missing. */
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
  /** Active saved replies (title + body); they are part of the prompt catalog. */
  replies: Array<{ title: string; body: string }>
  brandFacts: BrandFacts
  hoursEnabled: boolean
  /** Combos that include shipping (salesRules.bundles): free shipping by quantity, e.g. "2 bolsas". */
  freeShippingBundles?: string[]
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

const TEXT_TOPICS: Record<string, RegExp> = {
  ingredients: /ingrediente|contiene|lleva\b|formula|compuest|componente/,
  usage: /se usa|como se usa|modo de uso|se aplica|aplica|se pega|pegal|pegas|se coloca|coloca|despega/,
  frequency: /al dia|cada dia|diari|todos los dias|por noche|cada noche|una vez|vez al dia|\d+\s*(horas|minutos)|por uso/,
  results: /resultado|se nota|notan|cada (persona|organismo) responde|varia|no prometemos/,
  warnings: /embaraz|lactancia|medico|dentista|menores|alergi|irrita|no apt|consult/,
  returns: /devoluci|cambio|reembols|garantia|danado|incompleto/,
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** A short snippet around the first match (sentence-ish), payment-looking digits masked. */
function snippetAt(original: string, foldedIndex: number): string {
  const start = Math.max(0, original.lastIndexOf('\n', foldedIndex) + 1, foldedIndex - 80)
  const raw = original.slice(start, start + 160).split('\n')[0]
  return raw.replace(/\d[\d\s-]{6,}\d/g, '…').trim()
}

/** Text right after each mention of the product (to the next blank line, ≤700 chars) — same rule as the gaps check. */
function productWindows(folded: string, core: string): Array<{ index: number; text: string }> {
  const out: Array<{ index: number; text: string }> = []
  if (!core) return out
  let from = 0
  for (;;) {
    const at = folded.indexOf(core, from)
    if (at < 0) break
    const rest = folded.slice(at, at + 700)
    const blank = rest.search(/\n\s*\n/)
    out.push({ index: at, text: blank > 0 ? rest.slice(0, blank) : rest })
    from = at + core.length
  }
  return out
}

type Hit = { source: string; snippet: string; general: boolean }

function findTopic(docs: Array<{ name: string; body: string }>, topic: RegExp, core: string | null): Hit | null {
  // 1) The product's own text, 2) general text that applies to all products.
  for (const general of core ? [false, true] : [true]) {
    for (const d of docs) {
      const folded = fold(d.body)
      if (!general && core) {
        for (const w of productWindows(folded, core)) {
          const m = topic.exec(w.text)
          if (m) return { source: d.name, snippet: snippetAt(d.body, w.index + m.index), general: false }
        }
      } else {
        const m = topic.exec(folded)
        if (m) return { source: d.name, snippet: snippetAt(d.body, m.index), general: Boolean(core) }
      }
    }
  }
  return null
}

function textField(
  key: string,
  label: string,
  topic: RegExp,
  core: string | null,
  visible: Array<{ name: string; body: string }>,
  hidden: Array<{ name: string; body: string }>,
): MapField {
  const seen = findTopic(visible, topic, core)
  if (seen) return { key, label, status: 'ok', source: seen.general ? `general · ${seen.source}` : seen.source, snippet: seen.snippet, fix: 'answer' }
  const unseen = findTopic(hidden, topic, core)
  if (unseen) return { key, label, status: 'hidden', source: unseen.source, snippet: unseen.snippet, fix: 'answer' }
  return { key, label, status: 'missing', source: null, snippet: null, fix: 'answer' }
}

const structured = (key: string, label: string, ok: boolean, snippet: string | null, fix: MapFix): MapField =>
  ok ? { key, label, status: 'ok', source: 'configuración', snippet, fix } : { key, label, status: 'missing', source: null, snippet: null, fix }

const PAYMENT_LABELS: Record<string, string> = {
  sinpe: 'SINPE Móvil',
  transferencia: 'transferencia',
  tarjeta: 'tarjeta',
  efectivo: 'efectivo',
  contra_entrega: 'contra entrega',
}

function storeFields(facts: BrandFacts, hoursEnabled: boolean, freeBundles: string[], visible: Array<{ name: string; body: string }>, hidden: Array<{ name: string; body: string }>): MapField[] {
  const ea = facts.shipping?.ea
  const money = (n: number) => `₡${n.toLocaleString('es-CR')}`
  const costs = [ea?.gamCost, ea?.outsideGamCost].filter((n): n is number => typeof n === 'number')
  const methods = facts.payment?.methods ?? []
  return [
    structured('shipping_cost', 'Costo de envío', Boolean(ea?.enabled) && costs.length > 0, costs.length ? costs.map(money).join(' / ') : null, 'brand_facts'),
    structured('shipping_time', 'Tiempo de entrega', Boolean(ea?.etaText), ea?.etaText ?? null, 'brand_facts'),
    structured('free_shipping', 'Envío gratis', typeof ea?.freeOver === 'number' || freeBundles.length > 0, typeof ea?.freeOver === 'number' ? `desde ${money(ea.freeOver)}` : freeBundles.length ? `incluido en: ${freeBundles.slice(0, 3).join(', ')}` : null, 'brand_facts'),
    // Method labels only — never a SINPE number or IBAN.
    structured('payment', 'Formas de pago', methods.length > 0, methods.length ? methods.map((m) => PAYMENT_LABELS[m] ?? m).join(', ') : null, 'brand_facts'),
    structured('cod', 'Contra entrega', typeof facts.shipping?.contraEntrega?.enabled === 'boolean', facts.shipping?.contraEntrega ? (facts.shipping.contraEntrega.enabled ? 'sí' : 'no') : null, 'brand_facts'),
    structured('pickup', 'Retiro', typeof facts.shipping?.ra?.enabled === 'boolean', facts.shipping?.ra ? (facts.shipping.ra.enabled ? 'sí' : 'no') : null, 'brand_facts'),
    textField('returns', 'Cambios y devoluciones', TEXT_TOPICS.returns, null, visible, hidden),
    structured('hours', 'Horario', Boolean(facts.hoursText) || hoursEnabled, facts.hoursText ?? (hoursEnabled ? 'horario de atención configurado' : null), 'hours'),
  ]
}

/** Numbers that disagree with the structured facts (shown, never auto-fixed; they do not lower the %). */
export function findConflicts(input: Pick<MapInput, 'products' | 'brandFacts'> & { visible: Array<{ name: string; body: string }> }): MapConflict[] {
  const out: MapConflict[] = []
  const lines = input.visible.flatMap((d) => d.body.split('\n').map((line) => ({ doc: d.name, line, folded: fold(line) })))
  for (const p of input.products) {
    const core = productCoreName(p.name)
    if (!core || !(p.price > 0)) continue
    for (const l of lines) {
      // A combo / pack line quotes a bundle price, not the unit price.
      if (!l.folded.includes(core) || /combo|pack|paquetes|cajas|bolsas|\b[2-9]\s*x\b|full house|trio/.test(l.folded)) continue
      const wrong = colonAmountsIn(l.line).filter((a) => a >= 100 && a !== p.price)
      if (wrong.length) {
        out.push({ key: `price:${p.id}`, label: `Precio de ${p.name}`, detail: `"${l.doc}" dice ₡${wrong[0].toLocaleString('es-CR')}; el inventario dice ₡${p.price.toLocaleString('es-CR')}.` })
        break
      }
    }
  }
  const ea = input.brandFacts.shipping?.ea
  const allowed = new Set([ea?.gamCost, ea?.outsideGamCost, ea?.freeOver].filter((n): n is number => typeof n === 'number'))
  if (ea && allowed.size) {
    for (const l of lines) {
      if (!/env[ií]o/i.test(l.line) || /combo|pack|caja|bolsa|paquete/.test(l.folded)) continue
      const wrong = colonAmountsIn(l.line).filter((a) => a >= 100 && !allowed.has(a) && !input.products.some((p) => p.price === a))
      if (wrong.length) {
        out.push({ key: 'shipping_cost', label: 'Costo de envío', detail: `"${l.doc}" dice ₡${wrong[0].toLocaleString('es-CR')}; la configuración dice ${[...allowed].map((n) => `₡${n.toLocaleString('es-CR')}`).join(' / ')}.` })
        break
      }
    }
  }
  const eta = ea?.etaText ? fold(ea.etaText) : ''
  if (eta) {
    const etaRanges = new Set([...eta.matchAll(/(\d+)\s*a\s*(\d+)/g)].map((m) => `${m[1]}-${m[2]}`))
    for (const l of lines) {
      if (!/dias? habiles|dias? (?:para|en) llegar|llega en/.test(l.folded)) continue
      const ranges = [...l.folded.matchAll(/(\d+)\s*a\s*(\d+)\s*dias/g)].map((m) => `${m[1]}-${m[2]}`)
      const bad = ranges.find((r) => etaRanges.size && !etaRanges.has(r))
      if (bad) {
        out.push({ key: 'shipping_time', label: 'Tiempo de entrega', detail: `"${l.doc}" dice ${bad.replace('-', ' a ')} días; la configuración dice "${ea!.etaText}".` })
        break
      }
    }
  }
  return out
}

export function buildKnowledgeMap(input: MapInput): KnowledgeMap {
  const na = new Set(input.notApplicable ?? [])
  const replyDocs = input.replies.map((r) => ({ name: `respuesta guardada · ${r.title}`, body: `${r.title}\n${r.body}` }))
  const visible = [...input.docs.filter((d) => d.visible).map((d) => ({ name: d.name, body: d.body })), ...replyDocs]
  const hidden = input.docs.filter((d) => !d.visible).map((d) => ({ name: d.name, body: d.body }))

  const products: MapProduct[] = input.products.map((p) => {
    const core = productCoreName(p.name)
    const price: MapField =
      p.price > 0
        ? { key: 'price', label: 'Precio', status: 'ok', source: 'inventario', snippet: `₡${p.price.toLocaleString('es-CR')}`, fix: 'inventory' }
        : { key: 'price', label: 'Precio', status: 'missing', source: null, snippet: null, fix: 'inventory' }
    const fields: MapField[] = [
      price,
      ...PRODUCT_FIELDS.filter((f) => f.key !== 'price').map((f) => textField(f.key, f.label, TEXT_TOPICS[f.key], core, visible, hidden)),
    ].map((f): MapField => (na.has(`product.${f.key}`) ? { ...f, status: 'na' } : f))
    return { id: p.id, name: p.name, fields }
  })
  const store = storeFields(input.brandFacts, input.hoursEnabled, input.freeShippingBundles ?? [], visible, hidden).map((f) => (na.has(`store.${f.key}`) ? { ...f, status: 'na' as const } : f))

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
    conflicts: findConflicts({ products: input.products, brandFacts: input.brandFacts, visible }),
    lanes: [lane('brand_policy', 'Producto y políticas'), lane('faq', 'Preguntas frecuentes'), lane('corrections', 'Correcciones')],
    filled,
    total: all.length,
    percent: all.length ? Math.round((filled / all.length) * 100) : 0,
  }
}
