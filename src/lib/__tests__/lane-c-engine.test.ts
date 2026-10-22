/**
 * Lane C engine findings (Forge / Pura Sonrisa exams, 2026-10-22), fixed in lane D:
 * D1 a verbatim saved reply may state the totals the sales turn may state; D6 a bundle stored with its shipping included
 * may say "con envío incluido". (D2, the closed before-paying questions, are pinned in closed-pay-info.test.ts.)
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/lane-c-engine.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyFinalOutputPolicy, maskIncludedShipping, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'

const read = (p: string) => readFileSync(p, 'utf8')

describe('D1: a verbatim saved reply with an authorized total', () => {
  it('passes with the sales turn amounts, is held without them', () => {
    const text = '2 arneses en un pedido salen ₡32 800 en total 😊'
    assert.ok(applyFinalOutputPolicy({ text, skipPurchaseSummary: true }).reasons.includes('unsourced_amount') || applyFinalOutputPolicy({ text, skipPurchaseSummary: true }).reasons.includes('unsourced_money'))
    assert.deepEqual(applyFinalOutputPolicy({ text, skipPurchaseSummary: true, quoteAmounts: [32800] }).reasons, [])
  })
  it('the decision passes allowedAmounts to every saved reply; live and Probar compute them from one sales context', () => {
    const d = read('src/lib/soft-ai/inbound-decision.ts')
    assert.match(d, /shortcuts: input\.shortcuts,\s+quoteAmounts: input\.allowedAmounts,/)
    assert.equal((d.match(/facts: input\.brandFacts,\s+allowedAmounts: input\.allowedAmounts,/g) ?? []).length >= 10, true)
    const t = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(t, /allowedAmounts: turnSalesContext \? salesAllowedAmounts\(turnSalesContext\) : undefined,/)
    assert.match(t, /allowedAmounts: probarTurnSalesContext \? salesAllowedAmounts\(probarTurnSalesContext\) : undefined,/)
    assert.match(t, /salesContext: turnSalesContext,/)
    assert.match(t, /salesContext: probarTurnSalesContext,/)
  })
})

describe('D6: bundle with shipping included', () => {
  const r = (text: string, inc?: number[]) => validateAgentOutput({ text, citedToolNames: [], quoteAmounts: [32800], includedShippingAmounts: inc }).reasons
  it('"₡32 800 con envío incluido" passes only for an included-shipping bundle price', () => {
    assert.ok(r('2 arneses salen ₡32 800 con envío incluido 😊').includes('deal_offer'))
    assert.deepEqual(r('2 arneses salen ₡32 800 con envío incluido 😊', [32800]), [])
  })
  it('"gratis" and free shipping elsewhere are still held', () => {
    assert.ok(r('El envío es gratis y salen ₡32 800 con envío incluido', [32800]).includes('deal_offer'))
    assert.ok(r('Hoy envío incluido en todo 😊', [32800]).includes('deal_offer'))
    assert.equal(maskIncludedShipping('Salen ₡32 800 con envío incluido.', []), 'Salen ₡32 800 con envío incluido.')
  })
  it('SecureDog r2 F3 / Verifier r2 #7: excused only next to the bundle price alone', () => {
    const r2 = (text: string) => validateAgentOutput({ text, citedToolNames: [], quoteAmounts: [18000, 32800], includedShippingAmounts: [32800] }).reasons
    assert.ok(r2('El arnés sale ₡18 000 con envío incluido y el pack de 2 sale ₡32 800').includes('deal_offer'))
    assert.ok(r2('El pack de 2 sale ₡32 800 con envío incluido, y todos los demás productos incluyen el envío').includes('deal_offer'))
    assert.ok(!r2('El pack de 2 sale ₡32 800 con envío incluido.').includes('deal_offer'))
  })
  it('runtime + final policy (live and Probar) get the bundle amounts', () => {
    assert.match(read('src/lib/soft-ai/agent-turn-inputs.ts'), /salesIncludedShippingAmounts: sales \? \(sales\.bundles \?\? \[\]\)\.filter\(\(b\) => b\.shippingIncluded\)/)
    assert.match(read('src/lib/soft-ai/llm/runtime.ts'), /includedShippingAmounts: input\.salesIncludedShippingAmounts,/)
    assert.equal(read('src/lib/soft-ai/agent-turn.ts').match(/includedShippingAmounts: runtimeInput\.salesIncludedShippingAmounts,/g)?.length, 2)
  })
})
