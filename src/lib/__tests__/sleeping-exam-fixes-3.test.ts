/**
 * Pura Sonrisa final report (2026-10-18), batch 3 (slim): P4 classifier false hand-offs, P7 payment question in the
 * data list's message. Each case pinned. Pure; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/sleeping-exam-fixes-3.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, hasHardPaymentClaim, maskNonPaymentPhrases, paymentChoiceGrammar } from '@/lib/soft-ai/payment-classifier'
import { applyFinalOutputPolicy, splitReplyParts } from '@/lib/soft-ai/llm/output-validator'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { dataListBeforePaymentQuestion } from '@/lib/soft-ai/sales-state'
import { SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'

describe('P4: false payment hand-offs', () => {
  it('"retirar para no pagar envío" and a delivery person arriving are not payment messages', () => {
    for (const t of ['Quiero retirar para no pagar envío', 'Mejor lo retiro para no pagar el envío', 'Ya el Uber llegó', 'El Uber ya llegó', 'Ya llegó el Uber', 'Ya llegó el mensajero', 'https://m.uber.com/ul/?action=trip&id=12345678']) {
      assert.equal(classifyPaymentText(t), 'non_payment', t)
      assert.equal(hasHardPaymentClaim(t), false, t)
    }
  })
  it('a payment noun keeps the claim / hand-off ("Ya pagué, el Uber ya llegó")', () => {
    for (const t of ['Ya pagué, el Uber ya llegó', 'El Uber ya llegó, ya les hice el sinpe', '¿ya llegó el pago?', 'para no pagar el envío te hago el sinpe ahorita']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    assert.equal(maskNonPaymentPhrases('Ya llegó el pago'), 'Ya llegó el pago')
  })
  it('"Por SINPE, pasame el número" is a method choice + details ask', () => {
    for (const t of ['Por SINPE, pasame el número', 'Por sinpe, mandame los datos', 'Con transferencia, dame la cuenta']) {
      const g = paymentChoiceGrammar(t)
      assert.ok(g && g.ask, t)
      assert.equal(classifyPaymentText(t), 'non_payment', t)
    }
    assert.equal(classifyPaymentText('Por SINPE ya pasé el pago'), 'payment_proof_or_risk')
  })
})

describe('P7: the payment question never shares the data list\'s message', () => {
  it('list then question in one message → split; already separate → unchanged', () => {
    const same = `Para coordinar el envío, pasame estos datos:\n${SHIPPING_DATA_LIST}\n¿Cómo preferís pagar? Tenemos SINPE y tarjeta.`
    const parts = splitReplyParts(dataListBeforePaymentQuestion(same, 'shipping'))
    assert.equal(parts.length, 2)
    assert.ok(parts[0].includes('Nombre completo'))
    assert.match(parts[1], /^¿Cómo preferís pagar\?/)
    const ok = `Para coordinar el envío, pasame estos datos:\n${SHIPPING_DATA_LIST}\n\n¿Cómo preferís pagar? Tenemos SINPE y tarjeta.`
    assert.equal(dataListBeforePaymentQuestion(ok, 'shipping'), ok)
  })
  it('through the final policy too', () => {
    const facts = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta'], sinpe: { number: '62019914', holderName: 'X' } } })
    const p = applyFinalOutputPolicy({
      text: `Total ₡12 900.\n\nPasame estos datos:\n- Nombre completo\n- Teléfono\n- Provincia\n¿Cómo preferís pagar?`,
      brandFacts: facts,
      quoteAmounts: [12900],
      skipPurchaseSummary: true,
      shortenLongReply: true,
      paymentOptions: { dataListFirst: 'shipping' },
    })
    const qi = p.parts.findIndex((x) => /¿Cómo preferís pagar\?/.test(x))
    assert.ok(qi > 0 && !p.parts[qi].includes('Nombre completo'), p.parts.join(' | '))
  })
})


describe('Coordinator must-pass (2026-10-18): the three Pura Sonrisa blockers', () => {
  it('none of them is a payment hand-off', () => {
    for (const t of ['¿cómo sería el envío y el pago?', 'quería retirar para no pagar envío', 'Por SINPE móvil, pasame el número']) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
})

describe('SecureDog batch-2 r2 hardening: a "₡0" shipping cost never opens the ", y" split', () => {
  it('"…el envío cuesta ₡0, y el pack de 2 (₡19 800) trae envío incluido." stays blocked', async () => {
    const { validateAgentOutput } = await import('@/lib/soft-ai/llm/output-validator')
    const { salesFreeShippingRule, salesAllowedAmounts } = await import('@/lib/soft-ai/sales-state')
    const ctx = {
      catalog: [{ name: 'SleepingPatches', price: 9900, stockLabel: 'x' }],
      shippingMethods: [{ name: 'Correos', price: 3000, coverage: 'todo el país', cod: 'no' }],
      orderFields: [], salesScript: '', aiDisclosure: 'discreet' as const, paymentShareable: true, paymentDigits: [], promo: null,
      bundles: [{ name: 'Pack 2 bolsas (60 noches)', price: 19800, shippingIncluded: true }, { name: 'Pack 3 bolsas (90 noches)', price: 28500, shippingIncluded: false }],
    }
    const rule = salesFreeShippingRule(ctx)!
    const v = validateAgentOutput({ text: 'Con el pack de 3 el envío cuesta ₡0, y el pack de 2 bolsas (₡19 800) trae envío incluido.', citedToolNames: [], quoteAmounts: salesAllowedAmounts(ctx), freeShippingRule: rule })
    assert.equal(v.ok, false)
    const ok = validateAgentOutput({ text: 'Con 1 bolsa el envío cuesta ₡3 000, y el pack de 2 bolsas (₡19 800) trae envío incluido.', citedToolNames: [], quoteAmounts: salesAllowedAmounts(ctx), freeShippingRule: rule })
    assert.equal(ok.ok, true, String(ok.reasons))
  })
})

describe('Verifier b3 r1: cash handed to the courier stays a payment hand-off', () => {
  it('a delivery-arrival phrase is masked only next to courtesy', () => {
    for (const t of [
      'Ya llegó el mensajero, ya le di los 15 mil',
      'El mensajero ya llegó, le di 15000',
      'Ya llegó el mensajero y le entregué los 15 mil',
      'Ya llegó el mensajero, le dejé el efectivo',
      'Ya llegó el repartidor, todo listo',
      'El motorizado ya llegó, ya está',
      'Ya llegó el mensajero, ya quedó',
    ]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['Ya llegó el Uber, gracias', 'El Uber ya llegó 😊', 'Ya llegó el pedido, muchas gracias']) assert.equal(classifyPaymentText(t), 'non_payment', t)
  })
})

describe('SecureDog b3 r1 INT-187: cash-on-delivery claims next to "ya llegó el mensajero" keep the hand-off', () => {
  it('payment-state words after the arrival phrase are never masked', () => {
    for (const t of ['Ya llegó el mensajero, ya le di todo', 'Ya llegó el mensajero, ya está', 'El mensajero ya llegó y ya quedó', 'Ya llegó el mensajero y ya le entregué lo del pedido']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['Para no pagar envío lo retiro', 'quería retirar para no pagar envío']) assert.equal(classifyPaymentText(t), 'non_payment', t)
  })
})
