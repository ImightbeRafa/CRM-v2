/**
 * AL2-A1 validator v2 (A1.4, A1.5, A1.8).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseBrandFacts } from '../soft-ai/brand-facts'
import { applyFinalOutputPolicy, validateAgentOutput } from '../soft-ai/llm/output-validator'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '../soft-ai/shortcuts'

const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({
  ...row,
  isActive: true,
  sortOrder: index,
}))

const complete = parseBrandFacts({
  schemaVersion: 1,
  shipping: {
    ea: { enabled: true, gamCost: 2100, outsideGamCost: 2850 },
    ra: { enabled: true, text: 'Retiro en tienda' },
  },
  payment: {
    shareWithCustomers: true,
    methods: ['sinpe'],
    sinpe: { number: '88881234', holderName: 'Tienda' },
  },
})

describe('output validator v2', () => {
  it('A1.4 appends the purchase summary when envío or pago is missing', () => {
    const policy = applyFinalOutputPolicy({
      text: 'El kit cuesta ₡27000',
      intent: 'price',
      citedToolNames: ['search_inventory'],
      inventoryPrices: [27000],
      brandFacts: complete,
      shortcuts,
    })
    assert.equal(policy.purchaseSummaryAppended, true)
    assert.ok(policy.reasons.includes('purchase_summary_appended'))
    assert.match(policy.text, /27000|27\.000|27 000/)
    assert.match(policy.text, /2100/)
    assert.match(policy.text, /2850/)
    assert.match(policy.text, /pago|sinpe/i)
    assert.equal(policy.needsHuman, false)
  })

  it('A1.5 empty brand facts force a human on a purchase reply', () => {
    const policy = applyFinalOutputPolicy({
      text: 'El kit cuesta ₡27000',
      intent: 'price',
      citedToolNames: ['search_inventory'],
      inventoryPrices: [27000],
      brandFacts: parseBrandFacts({ schemaVersion: 1 }),
      shortcuts,
    })
    assert.equal(policy.needsHuman, true)
    assert.ok(policy.reasons.includes('brand_facts_missing'))
  })

  it('A1.8 an amount outside inventory and shipping is unsourced', () => {
    const result = validateAgentOutput({
      text: 'El extra sale en ₡5000',
      citedToolNames: ['search_inventory'],
      inventoryPrices: [27000],
      shippingAmounts: [2100, 2850],
    })
    assert.equal(result.needsHuman, true)
    assert.ok(result.reasons.includes('unsourced_amount'))
    assert.deepEqual(result.highlightedAmounts, [5000])
  })
})
