import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  amountsIn,
  deriveSalesState,
  formatSalesTurnBlock,
  salesAllowedAmounts,
  salesSystemBlock,
  type SalesContext,
} from '@/lib/soft-ai/sales-state'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

const read = (p: string) => readFileSync(p, 'utf8')

const CTX: SalesContext = {
  catalog: [
    { name: 'ARNESS FORGE XL', price: 14900, stockLabel: 'disponible' },
    { name: 'ARNESS FORGE 2XL', price: 14900, stockLabel: 'disponible' },
  ],
  shippingMethods: [
    { name: 'Envío a domicilio (GAM)', price: 3000, coverage: 'GAM', cod: 'según zona' },
    { name: 'Retiro en tienda', price: 0, coverage: 'en la tienda', cod: 'no aplica' },
  ],
  orderFields: ['Nombre', 'Teléfono', 'Talla (M/L/XL)'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['71133720'],
}

let n = 0
const msg = (direction: 'inbound' | 'outbound', content: string): SoftAiHistoryMessage => ({
  id: String((n += 1)),
  direction,
  content,
  sentAt: new Date(2026, 9, 9, 10, n).toISOString(),
})

describe('sales state (code decides the step; the model only writes it)', () => {
  it('reads money amounts the way people write them', () => {
    assert.deepEqual(amountsIn('₡14.900 y ₡3 000, total 17900'), [14900, 3000, 17900])
  })
  it('first message → saludo; after a quote → cotizar with price/shipping marked as said', () => {
    assert.equal(deriveSalesState({ history: [], inboundText: 'precio con envío?', ctx: CTX }).stage, 'saludo')
    const h = [msg('inbound', 'precio con envío?'), msg('outbound', 'El Arnés Forge está en ₡14.900. El envío a domicilio es ₡3.000.')]
    const s = deriveSalesState({ history: h, inboundText: 'tienen XL?', ctx: CTX })
    assert.equal(s.stage, 'cotizar')
    assert.deepEqual([s.said.price, s.said.shipping, s.said.payment], [true, true, false])
  })
  it('"¿cómo lo compro?" → cierre (ask for order data + give payment), never a hand-off', () => {
    const h = [msg('inbound', 'precio?'), msg('outbound', 'Está en ₡14.900.')]
    const s = deriveSalesState({ history: h, inboundText: 'como lo compro?', ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.match(s.nextStep, /datos del pedido/)
    assert.match(s.nextStep, /datos de pago/)
  })
  it('payment already given → waiting for receipt; "ya pagué" → verifying (never confirms)', () => {
    const h = [msg('outbound', 'Podés pagar por SINPE Móvil 7113-3720 a nombre de Forge.')]
    assert.equal(deriveSalesState({ history: h, inboundText: 'ok, nombre Ana', ctx: CTX }).stage, 'esperando_comprobante')
    const v = deriveSalesState({ history: h, inboundText: 'ya te hice el sinpe', ctx: CTX })
    assert.equal(v.stage, 'verificando')
    assert.match(v.nextStep, /Nunca confirmés el pago/)
  })
  it('turn block lists products, shipping, order fields and what was already said', () => {
    const s = deriveSalesState({ history: [msg('outbound', 'Está en ₡14.900')], inboundText: 'y el envío?', ctx: CTX })
    const block = formatSalesTurnBlock(CTX, s)
    assert.match(block, /ARNESS FORGE XL: ₡14[.\s ]900 · disponible/)
    assert.match(block, /Envío a domicilio \(GAM\): ₡3[.\s ]000/)
    assert.match(block, /Datos que necesita un pedido: Nombre, Teléfono, Talla/)
    assert.match(block, /ya dijiste precio ✓ · envío — /)
  })
  it('allowed amounts include product, shipping and simple totals (₡17.900)', () => {
    const a = salesAllowedAmounts(CTX)
    for (const v of [14900, 3000, 17900, 29800, 32800]) assert.ok(a.includes(v), String(v))
  })
  it('selling rules: no repeating, never "te paso con alguien", disclosure per agent', () => {
    const discreet = salesSystemBlock(CTX)
    assert.match(discreet, /Nunca repitas/)
    assert.match(discreet, /Nunca digas que vas a pasar el chat/)
    assert.match(discreet, /No digas que sos una IA/)
    assert.match(discreet, /no lo niegues/)
    assert.match(salesSystemBlock({ ...CTX, aiDisclosure: 'transparent' }), /asistente virtual de la tienda/)
  })
})

describe('wiring: same sales context in live and test chat; seller voice everywhere', () => {
  it('both paths load the sales context and pass its amounts to the final check', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal((turn.match(/salesContext: await loadAgentSalesContext\(/g) || []).length, 2)
    assert.equal((turn.match(/quoteAmounts: runtimeInput\.salesAllowedAmounts/g) || []).length, 2)
    assert.equal((turn.match(/skipPurchaseSummary: Boolean\(runtimeInput\.salesTurnBlock\)/g) || []).length, 2)
  })
  it('prompt: payment info given at close, hand-offs invisible, own messages labelled', () => {
    const prompt = read('src/lib/soft-ai/llm/prompt.ts')
    assert.match(prompt, /dá los datos de pago configurados tal cual/)
    assert.match(prompt, /Nunca le digas al cliente que lo vas a pasar con otra persona o equipo/)
    assert.match(prompt, /'Vos \(tienda\)'/)
    assert.match(read('src/lib/soft-ai/llm/tool-definitions.ts'), /NUNCA porque el cliente quiere comprar o pregunta cómo pagar/)
  })
  it('no fixed customer text says "persona del equipo"; old stored defaults upgrade on read', async () => {
    const { RESERVED_SHORTCUT_SEEDS, upgradeLegacyShortcutBody } = await import('@/lib/soft-ai/shortcuts')
    for (const s of RESERVED_SHORTCUT_SEEDS) assert.doesNotMatch(s.body, /persona del equipo|\bIA\b|\bbot\b/i, s.key)
    assert.equal(
      upgradeLegacyShortcutBody('En un momento te atiende una persona del equipo. Gracias por la paciencia.'),
      'Perfecto, dame un momento y te confirmo 😊',
    )
    assert.equal(upgradeLegacyShortcutBody('Mi texto propio'), 'Mi texto propio')
    assert.match(read('src/lib/soft-ai/shortcut-repository.ts'), /body: upgradeLegacyShortcutBody\(row\.body\)/)
  })
  it('without shipping methods the agent quotes from its own shipping facts', () => {
    const ctx = read('src/lib/soft-ai/agent-sales-context.ts')
    assert.match(ctx, /methods\.length === 0/)
    assert.match(ctx, /Envío a domicilio \(GAM\)/)
  })
})

describe('Verifier 2026-10-09 (sales flow) regressions', () => {
  it('negations and questions are not a close; accented "ya pagué" is a receipt; "pagado" alone is not', () => {
    const h = [msg('outbound', 'Está en ₡14.900. El envío es ₡3.000.')]
    for (const t of ['no lo quiero', 'ya no lo quiero', 'quiero una talla más grande', 'quiero una cotización']) {
      assert.notEqual(deriveSalesState({ history: h, inboundText: t, ctx: CTX }).stage, 'cierre', t)
    }
    assert.equal(deriveSalesState({ history: h, inboundText: 'lo quiero', ctx: CTX }).stage, 'cierre')
    for (const t of ['ya pagué', 'ya deposité', 'ya transferí']) {
      assert.equal(deriveSalesState({ history: h, inboundText: t, ctx: CTX }).stage, 'verificando', t)
    }
    assert.notEqual(deriveSalesState({ history: h, inboundText: '¿el envío va pagado?', ctx: CTX }).stage, 'verificando')
  })
  it('amounts on separate lines never merge; the store phone alone is not "payment given"', () => {
    assert.deepEqual(amountsIn('₡14.900\n300 unidades'), [14900]) // never merged into 14900300
    const phoneOnly = [msg('outbound', 'Cualquier cosa nos llamás al 7113-3720 😊')]
    assert.equal(deriveSalesState({ history: phoneOnly, inboundText: 'ok', ctx: CTX }).said.payment, false)
    const sinpe = [msg('outbound', 'Podés pagar por SINPE Móvil al 7113-3720.')]
    assert.equal(deriveSalesState({ history: sinpe, inboundText: 'ok', ctx: CTX }).said.payment, true)
  })
  it('payment not shareable → close asks for data and notifies the team silently', () => {
    const ctx = { ...CTX, paymentShareable: false }
    const s = deriveSalesState({ history: [msg('outbound', 'Está en ₡14.900')], inboundText: 'lo quiero', ctx })
    assert.match(formatSalesTurnBlock(ctx, s), /escalate_to_human\(payment_or_sinpe\)/)
    assert.doesNotMatch(formatSalesTurnBlock(CTX, s), /escalate_to_human/)
  })
})
