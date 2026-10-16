/**
 * Mapa de conocimiento (Rafael 2026-10-16): standard template per product + store, measured against what fits the
 * prompt budget ("escrito, pero no entra" counts as missing), conflicts with the structured facts, and the live gaps
 * route contract. Pure + source asserts; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-knowledge-map.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildKnowledgeMap, findConflicts, PRODUCT_FIELDS, STORE_FIELDS, type KnowledgeDocInput, type MapInput } from '@/lib/soft-ai/knowledge-map'
import { budgetKnowledgeSlice, KNOWLEDGE_LAYER2_CHAR_BUDGET, KNOWLEDGE_LAYER34_CHAR_BUDGET, type KnowledgeSourceDto } from '@/lib/soft-ai/knowledge-types'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'

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
  replies: [],
  brandFacts: FACTS,
  hoursEnabled: false,
  budgets: BUDGETS,
  ...over,
})

describe('template', () => {
  it('the same fields for every agent: 6 per product, 8 for the store', () => {
    assert.deepEqual(PRODUCT_FIELDS.map((f) => f.key), ['price', 'ingredients', 'usage', 'frequency', 'results', 'warnings'])
    assert.deepEqual(STORE_FIELDS.map((f) => f.key), ['shipping_cost', 'shipping_time', 'free_shipping', 'payment', 'cod', 'pickup', 'returns', 'hours'])
    const map = buildKnowledgeMap(base())
    assert.equal(map.total, 2 * 6 + 8)
  })

  it('structured facts come from settings (inventory price, brand facts), never from free text', () => {
    const map = buildKnowledgeMap(base())
    assert.equal(map.products[0].fields[0].source, 'inventario')
    const store = Object.fromEntries(map.store.map((f) => [f.key, f]))
    assert.equal(store.shipping_cost.status, 'ok')
    assert.equal(store.payment.snippet, 'SINPE Móvil, tarjeta')
    assert.doesNotMatch(JSON.stringify(map), /62019914/) // never a payment number
    assert.equal(store.returns.status, 'missing')
  })
})

describe('text fields', () => {
  const body = 'Focus Patch, ingredientes: melena de león y NAC. Se pega en el brazo, uno al día.\n\nEnergy Patch: energía para el día.\n\nSEGURIDAD: embarazo o lactancia, consultar al médico. Los resultados varían.\nDevoluciones: no se aceptan abiertas.'

  it('per product first, then general text that applies to all products', () => {
    const map = buildKnowledgeMap(base({ docs: [doc('Productos', body)] }))
    const focus = Object.fromEntries(map.products[0].fields.map((f) => [f.key, f]))
    const energy = Object.fromEntries(map.products[1].fields.map((f) => [f.key, f]))
    assert.equal(focus.ingredients.status, 'ok')
    assert.equal(focus.ingredients.source, 'Productos')
    assert.equal(energy.ingredients.status, 'ok') // general fallback: "ingredientes" appears in the text
    assert.match(energy.ingredients.source ?? '', /^general · /)
    assert.equal(focus.warnings.status, 'ok')
    assert.equal(map.store.find((f) => f.key === 'returns')?.status, 'ok')
  })

  it('text the agent cannot see ("no entra") is hidden, and counts as missing', () => {
    const map = buildKnowledgeMap(base({ docs: [doc('Productos', body, false)] }))
    const focus = Object.fromEntries(map.products[0].fields.map((f) => [f.key, f]))
    assert.equal(focus.ingredients.status, 'hidden')
    assert.ok(map.filled < map.total)
    const lane = map.lanes.find((l) => l.key === 'brand_policy')!
    assert.equal(lane.used, 0)
    assert.equal(lane.written, body.length)
  })

  it('active saved replies count as visible knowledge', () => {
    const map = buildKnowledgeMap(base({ replies: [{ title: 'Focus', body: 'Focus Patch: ingredientes melena de león' }] }))
    assert.equal(map.products[0].fields.find((f) => f.key === 'ingredients')?.status, 'ok')
  })
})

describe('% and no aplica', () => {
  it('counts first, then a rounded %; not-applicable fields leave the total', () => {
    const all = buildKnowledgeMap(base())
    const na = buildKnowledgeMap(base({ notApplicable: ['product.ingredients', 'store.pickup'] }))
    assert.equal(na.total, all.total - 2 - 1)
    assert.equal(all.percent, Math.round((all.filled / all.total) * 100))
  })
  it('free shipping by quantity (combo that includes shipping) counts', () => {
    const facts = parseBrandFactsSafe({ schemaVersion: 1, shipping: { ea: { enabled: true, gamCost: 3000, outsideGamCost: 3000 } } })
    const map = buildKnowledgeMap(base({ brandFacts: facts, freeShippingBundles: ['Pack 2 bolsas'] }))
    assert.equal(map.store.find((f) => f.key === 'free_shipping')?.status, 'ok')
  })
})

describe('conflicts (shown, never fixed, do not lower the %)', () => {
  it('a unit price in the text that differs from inventory', () => {
    const c = findConflicts({ products: [{ id: 'f', name: 'Focus Patch', price: 9900 }], brandFacts: FACTS, visible: [{ name: 'Productos', body: 'Focus Patch: ₡10.900 el paquete.' }] })
    assert.equal(c.length, 1)
    assert.match(c[0].detail, /₡10\D?900/)
  })
  it('combo lines and matching prices are not conflicts', () => {
    const c = findConflicts({ products: [{ id: 'f', name: 'Focus Patch', price: 9900 }], brandFacts: FACTS, visible: [{ name: 'P', body: 'Focus Patch: ₡9.900.\nCombo Focus Patch + Energy: ₡17.900' }] })
    assert.equal(c.length, 0)
  })
  it('shipping cost and delivery days that differ from the settings', () => {
    const c = findConflicts({ products: [], brandFacts: FACTS, visible: [{ name: 'FAQ', body: 'El envío cuesta ₡2.600.\nLlega en 3 a 7 días hábiles.' }] })
    assert.deepEqual(c.map((x) => x.key).sort(), ['shipping_cost', 'shipping_time'])
  })
})

describe('real case: the oversized PatchHouse texts of 2026-10-16', () => {
  it('a 4,397-char brand book alone is over the 4,000 budget and is skipped whole', () => {
    const big = 'x'.repeat(4397)
    const src = (id: string, kind: 'brand_book' | 'policy' | 'faq', body: string) =>
      ({ id, tenantId: 't', socialAccountId: null, kind, name: id, body, status: 'approved', version: 1, contentHash: '', metadata: null, approvedBy: null, approvedAt: null }) as KnowledgeSourceDto
    const b = budgetKnowledgeSlice({ brandBook: [src('prod', 'brand_book', big)], policies: [src('pol', 'policy', 'y'.repeat(804))], faqs: [src('faq', 'faq', 'z'.repeat(3222))], channelOverlay: [], versions: [] })
    assert.equal(KNOWLEDGE_LAYER2_CHAR_BUDGET, 4000)
    assert.equal(KNOWLEDGE_LAYER34_CHAR_BUDGET, 3000)
    assert.deepEqual(b.brandBook.map((s) => s.id), [])
    assert.deepEqual(b.policies.map((s) => s.id), ['pol'])
    assert.deepEqual(b.faqs.map((s) => s.id), [])
  })
})

describe('route + server contract (source)', () => {
  const route = readFileSync('src/app/api/chat/agents/[id]/knowledge-map/route.ts', 'utf8')
  const server = readFileSync('src/lib/soft-ai/knowledge-map-server.ts', 'utf8')
  it('view_config, tenant from the session, no-store, gaps only with update_sales', () => {
    assert.match(route, /authenticateAPIWithPermission\(request, 'view_config'\)/)
    assert.match(route, /tenantId: auth\.tenantId/)
    assert.match(route, /'Cache-Control': 'no-store'/)
    assert.match(route, /includeGaps: hasPermission\(auth\.role, 'update_sales'\)/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/) // read-only in v1
  })
  it('gaps: outcome marker path, real customers only, 90 days, masked text, tenant-scoped messages', () => {
    assert.match(server, /path: \['outcomeMarkers', 'handoffReason'\], equals: 'unknown_answer'/)
    assert.match(server, /testSessionId: null/)
    assert.match(server, /GAP_WINDOW_DAYS = 90/)
    assert.match(server, /sanitizeTuneQuestion\(raw\)\.slice\(0, 200\)/)
    assert.match(server, /where: \{ tenantId, id: \{ in: ids \}, direction: 'inbound' \}/)
    assert.match(server, /budgetKnowledgeSlice\(slice\)/) // measures what the agent really sees
  })
  it('the map is shown in the Conocimiento tab', () => {
    const tab = readFileSync('src/components/aurora/agentes/AgentKnowledgeTab.tsx', 'utf8')
    assert.match(tab, /<KnowledgeMapCard agentId=\{agentId\} refreshKey=\{mapKey\} \/>/)
  })
})
