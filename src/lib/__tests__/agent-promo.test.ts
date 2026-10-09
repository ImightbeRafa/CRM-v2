import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePromo, promoAllowedDeals, promoInEffect } from '@/lib/soft-ai/promo'
import { applyFinalOutputPolicy, dealProblem } from '@/lib/soft-ai/llm/output-validator'

const read = (p: string) => readFileSync(p, 'utf8')

describe('B1 promoción activa — configured by the owner, applied by code', () => {
  it('parse is bounded; the headline never carries prices', () => {
    const p = parsePromo({ active: true, freeShipping: true, headline: 'Envío gratis ₡14.900 a todo CR', specialPrices: [{ scope: 'category', ref: 'ARNESS', price: 14900 }, { scope: 'x', ref: 1 }], junk: 1 })
    assert.equal(p.headline, 'Envío gratis a todo CR')
    assert.equal(p.specialPrices.length, 1)
    assert.equal((p as unknown as Record<string, unknown>).junk, undefined)
  })
  it('in effect only while active and not past its end day', () => {
    const p = parsePromo({ active: true, freeShipping: true, endsAt: '2026-10-31' })
    assert.equal(promoInEffect(p, new Date('2026-10-31T20:00:00Z')), true)
    assert.equal(promoInEffect(p, new Date('2026-11-01T12:00:00Z')), false)
    assert.equal(promoInEffect(parsePromo({ active: false, freeShipping: true })), false)
    assert.deepEqual(promoAllowedDeals(parsePromo({ active: true, freeShipping: true })), ['free_shipping'])
  })
  it('free shipping is allowed only with the promo; invented deals always fail', () => {
    assert.equal(dealProblem('¡El envío gratis a todo Costa Rica!', ['free_shipping']), false)
    assert.equal(dealProblem('¡El envío gratis a todo Costa Rica!', []), true)
    assert.equal(dealProblem('Precio especial ₡14.900', ['special_price']), false)
    for (const t of ['Te hago un 10% de descuento', 'Te lo dejo en ₡12.000', 'Es 2x1 hoy', 'Te regalo el cargador']) {
      assert.equal(dealProblem(t, ['free_shipping', 'special_price']), true, t)
    }
  })
  it('free-shipping promo: the store\'s fixed ₡3.000 is no longer a valid amount', () => {
    const facts = { schemaVersion: 1 as const, shipping: { ea: { enabled: true, gamCost: 3000, outsideGamCost: 3000 } } }
    const withPromo = applyFinalOutputPolicy({ text: 'El envío es ₡3.000', brandFacts: facts, skipPurchaseSummary: true, freeShipping: true, allowedDeals: ['free_shipping'] })
    assert.equal(withPromo.needsHuman, true)
    const without = applyFinalOutputPolicy({ text: 'El envío es ₡3.000', brandFacts: facts, skipPurchaseSummary: true })
    assert.equal(without.needsHuman, false)
  })
  it('wiring: promo applied in the sales context, passed to both final checks, rule 12 exception, store shipping hidden', () => {
    const ctx = read('src/lib/soft-ai/agent-sales-context.ts')
    assert.match(ctx, /gratis \(promoción\)/)
    assert.match(ctx, /specialFor\(i\) \?\? Number\(i\.sellingPrice\)/)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal((turn.match(/freeShipping: runtimeInput\.salesFreeShipping/g) || []).length, 2)
    assert.match(read('src/lib/soft-ai/llm/prompt.ts'), /Única excepción: la "Promoción activa" que Betsy lista en BETSY_DATOS/)
    assert.match(read('src/lib/soft-ai/agent-turn-inputs.ts'), /shipping: undefined/)
    assert.match(read('src/lib/soft-ai/test-engine/generate.ts'), /AGENT_RULES_VERSION = 'saved-replies-2026-10-09'/ /* bumped again by the saved-replies slice (catalog wording) */)
    const route = read('src/app/api/chat/agents/[id]/settings/route.ts')
    assert.match(route, /if \('promo' in body\)/)
    assert.match(route, /where: \{ tenantId: auth\.tenantId, id: \{ in: promo\.freeShippingMethodIds \} \}/)
  })
})
