/**
 * Mapa de conocimiento (Rafael 2026-10-16): standard template per product + store, measured against what the agent
 * REALLY sees (prompt budget, saved-reply catalog, shipping methods), conflicts with the structured facts, and the
 * live gaps. Verifier round 1 cases included (store words counted as product knowledge, hidden text masked, reserved
 * replies, borrowed ingredients, conflict false positives, "ya respondida" from hidden text). Pure + source asserts.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-knowledge-map.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildKnowledgeMap, findConflicts, gapAnswered, PRODUCT_FIELDS, STORE_FIELDS, type KnowledgeDocInput, type MapInput } from '@/lib/soft-ai/knowledge-map'
import { groupGaps, maskGapQuestion } from '@/lib/soft-ai/knowledge-map-server'
import { budgetKnowledgeSlice, KNOWLEDGE_LAYER2_CHAR_BUDGET, KNOWLEDGE_LAYER34_CHAR_BUDGET, type KnowledgeSourceDto } from '@/lib/soft-ai/knowledge-types'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { guideCatalogRows, RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import { normalizeQuestion } from '@/lib/soft-ai/agent-tuning-core'

const FACTS = parseBrandFactsSafe({
  schemaVersion: 1,
  storeName: 'Tienda',
  hoursText: 'Lunes a viernes 9 a 6',
  shipping: {
    ea: { enabled: true, gamCost: 3000, outsideGamCost: 3000, freeOver: 25000, etaText: '2 a 5 días hábiles' },
    ra: { enabled: true, text: 'Retiro con cita' },
    contraEntrega: { enabled: true, text: 'Solo GAM' },
  },
  payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta'], sinpe: { number: '62019914', holderName: 'X' } },
})
const BUDGETS = { brand_policy: 4000, faq: 3000, corrections: 2400 }
const doc = (name: string, body: string, visible = true, lane: KnowledgeDocInput['lane'] = 'brand_policy'): KnowledgeDocInput => ({ name, kind: 'brand_book', body, visible, lane })
const base = (over: Partial<MapInput> = {}): MapInput => ({
  products: [
    { id: 'f', name: 'Focus Patch', price: 9900 },
    { id: 'e', name: 'Energy Patch', price: 9900 },
  ],
  docs: [],
  catalogReplies: [],
  brandFacts: FACTS,
  shippingMethods: [],
  budgets: BUDGETS,
  ...over,
})
const fieldsOf = (map: ReturnType<typeof buildKnowledgeMap>, i: number) => Object.fromEntries(map.products[i].fields.map((f) => [f.key, f]))
const storeOf = (map: ReturnType<typeof buildKnowledgeMap>) => Object.fromEntries(map.store.map((f) => [f.key, f]))
const STORE_WORDS = 'El envío lleva 2 a 5 días hábiles. Tenemos varias formas de pago. La promo aplica solo GAM. Para consultas escribinos. Cualquier cambio en el pedido, avisanos. Llená el formulario.'

describe('template', () => {
  it('the same fields for every agent: 6 per product, 8 for the store', () => {
    assert.deepEqual(PRODUCT_FIELDS.map((f) => f.key), ['price', 'ingredients', 'usage', 'frequency', 'results', 'warnings'])
    assert.deepEqual(STORE_FIELDS.map((f) => f.key), ['shipping_cost', 'shipping_time', 'free_shipping', 'payment', 'cod', 'pickup', 'returns', 'hours'])
    assert.equal(buildKnowledgeMap(base()).total, 2 * 6 + 8)
  })
  it('price from inventory; payment as method labels, never a payment number', () => {
    const map = buildKnowledgeMap(base())
    assert.equal(fieldsOf(map, 0).price.source, 'inventario')
    assert.equal(storeOf(map).payment.snippet, 'SINPE Móvil, tarjeta')
    assert.doesNotMatch(JSON.stringify(map), /62019914/)
  })
})

describe('product text: only real product knowledge counts (verifier F1)', () => {
  it('store words ("lleva", "aplica", "varias", "consultas", "cambio", "formulario") are not product knowledge', () => {
    const map = buildKnowledgeMap(base({ docs: [doc('Políticas', STORE_WORDS)] }))
    for (const k of ['ingredients', 'usage', 'results', 'warnings']) assert.equal(fieldsOf(map, 0)[k].status, 'missing', k)
  })
  it('a hidden product paragraph is reported as "no entra", never masked by a visible unrelated line', () => {
    const hidden = doc('Productos', 'Focus Patch, ingredientes: melena de león. Se pega en el brazo, uno al día. Los resultados varían. Embarazo: consultar al médico.', false)
    const map = buildKnowledgeMap(base({ docs: [hidden, doc('Políticas', STORE_WORDS)] }))
    for (const k of ['ingredients', 'usage', 'frequency', 'results', 'warnings']) assert.equal(fieldsOf(map, 0)[k].status, 'hidden', k)
  })
  it('ingredients are never borrowed from another product or from general text', () => {
    const map = buildKnowledgeMap(base({ docs: [doc('Productos', 'Focus Patch, ingredientes: melena de león.\n\nEnergy Patch: energía.\n\nTodos los parches: ingredientes de origen natural.')] }))
    assert.equal(fieldsOf(map, 0).ingredients.status, 'ok')
    assert.equal(fieldsOf(map, 1).ingredients.status, 'missing')
  })
  it('general paragraphs that name no product count for use / warnings (with the source marked general)', () => {
    const map = buildKnowledgeMap(base({ docs: [doc('Productos', 'Focus Patch, ingredientes: NAC.\n\nUSO (igual para todos): se pega en piel limpia, uno al día.\n\nSEGURIDAD: embarazo o lactancia, consultar al médico.')] }))
    const energy = fieldsOf(map, 1)
    assert.equal(energy.usage.status, 'ok')
    assert.match(energy.usage.source ?? '', /^general · Productos$/)
    assert.equal(energy.warnings.status, 'ok')
  })
})

describe('what the agent really sees', () => {
  it('reserved replies (e.g. "…no me aparece aplicado") are not in the prompt catalog', () => {
    const rows: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
    assert.equal(guideCatalogRows(rows).length, 0)
  })
  it('a saved reply counts only as the catalog shows it (300-char body)', () => {
    const rows: RuntimeShortcut[] = [{ key: 'uso', title: 'Modo de uso', kind: 'playbook', intents: [], keywords: [], body: `Focus Patch ${'x'.repeat(320)} embarazo consultar al médico`, deliveryMode: 'guide', isActive: true, sortOrder: 0 }]
    const map = buildKnowledgeMap(base({ catalogReplies: guideCatalogRows(rows).map((r) => ({ title: r.title, body: r.body })) }))
    assert.equal(fieldsOf(map, 0).warnings.status, 'missing')
  })
  it('shipping comes from the shipping methods when the business has them (as the live sales context)', () => {
    const facts = parseBrandFactsSafe({ schemaVersion: 1 })
    const map = buildKnowledgeMap(base({ brandFacts: facts, shippingMethods: [{ name: 'Correos', price: 2600, allowsCod: false }] }))
    assert.equal(storeOf(map).shipping_cost.status, 'ok')
    assert.match(storeOf(map).shipping_cost.snippet ?? '', /Correos/)
    assert.equal(storeOf(map).cod.snippet, 'no')
    assert.equal(storeOf(map).shipping_time.status, 'missing') // brand facts eta does not reach the prompt with methods
  })
  it('free shipping only via combos or promo (freeOver never reaches the agent); hours only via the hours text', () => {
    assert.equal(storeOf(buildKnowledgeMap(base())).free_shipping.status, 'missing')
    assert.equal(storeOf(buildKnowledgeMap(base({ freeShippingBundles: ['Pack 2 bolsas'] }))).free_shipping.status, 'ok')
    assert.equal(storeOf(buildKnowledgeMap(base({ promoFreeShipping: true }))).free_shipping.status, 'ok')
    const noHours = parseBrandFactsSafe({ schemaVersion: 1 })
    assert.equal(storeOf(buildKnowledgeMap(base({ brandFacts: noHours }))).hours.status, 'missing')
  })
  it('returns text and extra facts from the business data count (they are in the prompt)', () => {
    const facts = parseBrandFactsSafe({ schemaVersion: 1, returnsText: 'No se aceptan abiertos', extraFacts: [{ label: 'Uso', value: 'Se pega en el brazo, uno al día' }] })
    const map = buildKnowledgeMap(base({ brandFacts: facts }))
    assert.equal(storeOf(map).returns.status, 'ok')
    assert.equal(fieldsOf(map, 0).usage.status, 'ok')
  })
})

describe('% and no aplica', () => {
  it('counts first, then a rounded %; not-applicable fields leave the total', () => {
    const all = buildKnowledgeMap(base())
    const na = buildKnowledgeMap(base({ notApplicable: ['product.ingredients', 'store.pickup'] }))
    assert.equal(na.total, all.total - 2 - 1)
    assert.equal(all.percent, Math.round((all.filled / all.total) * 100))
  })
})

describe('conflicts (verifier F5)', () => {
  const run = (body: string, products = [{ id: 'f', name: 'Focus Patch', price: 9900 }, { id: 'e', name: 'Energy Patch', price: 12900 }]) =>
    findConflicts({ products, brandFacts: FACTS, shippingMethods: [], visible: [{ name: 'Doc', body }] })
  it('a unit price in the text that differs from inventory is flagged', () => {
    const c = run('Focus Patch: ₡10.900 el paquete.')
    assert.equal(c.length, 1)
    assert.match(c[0].detail, /₡10\D?900/)
  })
  it('no false alarms: shipping amount, two products on one line, x2 / unidades / antes-ahora, P: lines', () => {
    for (const body of [
      'Focus Patch ₡9.900 + envío ₡3.000',
      'Focus Patch ₡9.900 · Energy Patch ₡12.900',
      'Focus Patch x2: ₡17.900',
      'Focus Patch 2 unidades ₡17.900',
      'Focus Patch antes ₡12.900, ahora ₡9.900',
      'P: ¿el Focus Patch cuesta ₡5.000?',
    ]) {
      assert.equal(run(body).length, 0, body)
    }
  })
  it('shipping cost and delivery days that differ from the settings; "reclamos en 1 a 2 días" is not delivery', () => {
    assert.deepEqual(run('El envío cuesta ₡2.600.\nEl envío llega en 3 a 7 días hábiles.', []).map((x) => x.key).sort(), ['shipping_cost', 'shipping_time'])
    assert.equal(run('Respondemos en 1 a 2 días hábiles los reclamos.', []).length, 0)
  })
})

describe('live gaps (verifier F4)', () => {
  it('masks, groups, and sorts unanswered first', () => {
    const turns = [
      { id: 't1', createdAt: new Date('2026-10-16'), conversationId: 'c1', text: '¿Tiene alcohol?' },
      { id: 't2', createdAt: new Date('2026-10-15'), conversationId: 'c2', text: '¿tiene alcóhol?' },
      { id: 't3', createdAt: new Date('2026-10-14'), conversationId: 'c3', text: '¿Cuánto dura?' },
      { id: 't4', createdAt: new Date('2026-10-13'), conversationId: 'c4', text: 'Llamame al 8888 8888 para lo del pedido' },
    ]
    const g = groupGaps(turns, ['P: ¿Cuánto dura?\nR: 8 horas.'])
    assert.equal(g.length, 3)
    assert.equal(g[0].count, 2) // same question, different case / accent
    assert.equal(g[0].answered, false)
    assert.doesNotMatch(g.map((x) => x.question).join(' '), /8888/)
    assert.equal(g.find((x) => /dura/i.test(x.question))?.answered, true)
  })
  it('masking: spelled-out numbers and the customer\'s own name are removed (DATA-57)', () => {
    const q = maskGapQuestion('Hola soy María Pérez, mi sinpe es ocho ocho ocho ocho uno dos tres cuatro', ['María Pérez'])
    assert.doesNotMatch(q, /María|Pérez|ocho ocho/)
    assert.ok(maskGapQuestion('x'.repeat(5000)).length <= 200)
  })
  it('"ya respondida" only from visible text: a whole P: line, or every word in one paragraph', () => {
    assert.equal(gapAnswered('¿Ingredientes?', ['Los ingredientes son naturales'], normalizeQuestion), false) // single word: no fuzzy match
    assert.equal(gapAnswered('y el energy', ['Energy Patch: cafeína'], normalizeQuestion), false)
    assert.equal(gapAnswered('¿Puedo tomar café?', ['P: ¿Puedo tomar café?\nR: Sí'], normalizeQuestion), true)
  })
})

describe('performance (SecureDog INT-127)', () => {
  it('200 products incl. "1" / "11" and two 12,000-digit documents stay fast', () => {
    const products = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, name: i === 0 ? '1' : i === 1 ? '11' : `Producto ${i}`, price: 1000 }))
    const digits = '1'.repeat(12000)
    const docs = [doc('A', digits), doc('B', digits, false), doc('C', 'Producto 5, ingredientes: x.\n\n'.repeat(400))]
    const t0 = performance.now()
    const map = buildKnowledgeMap(base({ products, docs }))
    const ms = performance.now() - t0
    assert.equal(map.products.length, 200)
    assert.ok(ms < 1500, `took ${Math.round(ms)} ms`)
  })
  it('size caps: documents over the limits are reported as not measured', () => {
    const many = Array.from({ length: 70 }, (_, i) => doc(`D${i}`, 'texto'))
    assert.equal(buildKnowledgeMap(base({ docs: many })).notMeasured, 10)
  })
  it('snippets never show payment numbers in any format', () => {
    const map = buildKnowledgeMap(base({ docs: [doc('P', 'Focus Patch, ingredientes: NAC. SINPE 8888.1234 · IBAN CR05.0152.0200.1026.2840.66 · 8888_1234')] }))
    const snip = map.products[0].fields.find((f) => f.key === 'ingredients')?.snippet ?? ''
    assert.doesNotMatch(snip, /8888|0152|1026|2840/)
  })
})

describe('real case: the oversized PatchHouse texts of 2026-10-16', () => {
  it('a 4,397-char brand book alone is over the 4,000 budget and is skipped whole', () => {
    const src = (id: string, kind: 'brand_book' | 'policy' | 'faq', body: string) =>
      ({ id, tenantId: 't', socialAccountId: null, kind, name: id, body, status: 'approved', version: 1, contentHash: '', metadata: null, approvedBy: null, approvedAt: null }) as KnowledgeSourceDto
    const b = budgetKnowledgeSlice({ brandBook: [src('prod', 'brand_book', 'x'.repeat(4397))], policies: [src('pol', 'policy', 'y'.repeat(804))], faqs: [src('faq', 'faq', 'z'.repeat(3222))], channelOverlay: [], versions: [] })
    assert.equal(KNOWLEDGE_LAYER2_CHAR_BUDGET, 4000)
    assert.equal(KNOWLEDGE_LAYER34_CHAR_BUDGET, 3000)
    assert.deepEqual([b.brandBook.length, b.policies.length, b.faqs.length], [0, 1, 0])
  })
})

describe('route + server + UI contract (source)', () => {
  const route = readFileSync('src/app/api/chat/agents/[id]/knowledge-map/route.ts', 'utf8')
  const server = readFileSync('src/lib/soft-ai/knowledge-map-server.ts', 'utf8')
  const card = readFileSync('src/components/aurora/agentes/KnowledgeMapCard.tsx', 'utf8')
  it('view_config, tenant from the session, no-store, gaps only with update_sales, read-only', () => {
    assert.match(route, /authenticateAPIWithPermission\(request, 'view_config'\)/)
    assert.match(route, /tenantId: auth\.tenantId/)
    assert.match(route, /'Cache-Control': 'no-store'/)
    assert.match(route, /const includeGaps = hasPermission\(auth\.role, 'update_config'\)/)
    assert.match(route, /createIdentifierRateLimit\(\{ windowMs: 60_000, maxRequests: 20/)
    assert.match(route, /CACHE_MS = 30_000/)
    assert.match(route, /searchParams\.get\('fresh'\) === '1'/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  })
  it('server mirrors the live sources and filters gaps to real customers in 90 days', () => {
    assert.match(server, /budgetKnowledgeSlice\(slice\)/)
    assert.match(server, /guideCatalogRows\(shortcuts\)/)
    assert.match(server, /loadCoverage\(input\.tenantId\)/)
    assert.match(server, /path: \['outcomeMarkers', 'handoffReason'\], equals: 'unknown_answer'/)
    assert.match(server, /testSessionId: null/)
    assert.match(server, /GAP_WINDOW_DAYS = 90/)
    assert.match(server, /where: \{ tenantId, id: \{ in: ids \}, direction: 'inbound' \}/)
  })
  it('UI: visible status text and legend (not only colour), loads only when the tab is open, keyed per agent', () => {
    assert.match(card, /Lo sabe/)
    assert.match(card, /Escrito, pero no entra/)
    assert.match(card, /if \(!active\) return/)
    const tab = readFileSync('src/components/aurora/agentes/AgentKnowledgeTab.tsx', 'utf8')
    assert.match(tab, /<KnowledgeMapCard key=\{agentId\} agentId=\{agentId\} active=\{active\} refreshKey=\{mapKey\} \/>/)
  })
})
