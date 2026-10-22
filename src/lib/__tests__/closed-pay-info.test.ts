/**
 * Lane C Forge exam 2026-10-22 (real chats real-49 / real-61): closed before-paying questions are answered by the agent,
 * never handed off — "Que le pongo de detalle" (SINPE note) and "¿se puede pagar cuando ya está acá el producto?"
 * (cash on delivery). Real claims and pasted numbers keep the person path.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/closed-pay-info.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, isClosedPayInfoQuestion, normalizePaySpelling } from '@/lib/soft-ai/payment-classifier'
import { deriveSalesState, type SalesContext } from '@/lib/soft-ai/sales-state'
import { paymentCheckGate } from '@/lib/soft-ai/payment-claim-check-core'
import { isPaymentSensitiveText } from '@/lib/soft-ai/config'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'

const FACTS = parseBrandFacts({
  payment: { shareWithCustomers: true, methods: ['sinpe', 'contra_entrega'], sinpe: { number: '88880000', holderName: 'Ana Mora' } },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))

const SAFE = [
  'Que le pongo de detalle',
  '¿Qué le pongo de detalle?',
  '¿Qué pongo en el detalle del sinpe?',
  'En el detalle qué pongo?',
  '¿Qué va en la descripción de la transferencia?',
  'Como es el método de pago?? se puede pagar cuando ya está acá el producto??',
  '¿Se puede pagar cuando llegue?',
  'hola, ¿puedo pagar al recibir?',
  '¿Tienen contra entrega?',
  'Disculpe ¿cómo se paga?',
  'Hola! ¿Qué le pongo de detalle? Gracias',
  // Verifier r2 #3
  'Perfecto, ¿qué le pongo de detalle?',
  'Dale, ¿qué le pongo de detalle?',
  'Ok perfecto, que le pongo de detalle',
  // Lane C D2 (real Forge / Pura Sonrisa chats, 2026-10-22)
  'Cual sería el número para hacerte un SINPE',
  'Lo quiero talla XL. ¿Puedo hacer el pago mañana y envío el comprobante?',
  'Vivo en Heredia centro, ¿puedo pagar contra entrega?',
  'Quiero pagar por SINPE, cuánto sería',
  'te puedo mandar el número de la tarjeta por acá?',
  'Y el envío y pago como sería?',
  // Lane C D2 round 2
  'Hola! quiero pagar ya, te paso el número de mi tarjeta por acá?',
  'Hola buenas tardes quisiera saber como sería el envío y el pago?',
  'Dale, pago por SINPE. Me pasás el número y a nombre de quién?',
]

const NOT_CLOSED = [
  'Que le pongo de detalle? ya pagué',
  'Le puse de detalle mi nombre',
  'Qué le pongo de detalle 8888-1234',
  'Ya está, qué le pongo de detalle',
  'Se puede pagar cuando ya está acá? ya lo mandé',
  'ya pagué, se puede pagar cuando llegue el resto?',
  'qué le pongo de detalle, ya hice el sinpe',
  'Mi tarjeta es 4111 1111 1111 1111, ¿cómo se paga?',
  'Hola',
  'Gracias. Ya pagué',
  'Listo, ¿qué le pongo de detalle?',
  'Sí. ¿Qué le pongo de detalle?',
  'Vivo en Heredia ya pagué, ¿puedo pagar contra entrega?',
  'Lo quiero. Ya pagué',
  'Lo quiero',
  'Ya pagué, me pasás el número?',
  'Pagué por SINPE. Me pasás el número?',
  // Verifier r2 #1
  'Vivo en Heredia y le pague. ¿A nombre de quién está?',
  'Vivo en Cartago y les pague. A nombre de quién?',
  'Vivo en Heredia y cancele. ¿Puedo pagar contra entrega?',
  'Vivo en Heredia Pagué. ¿Puedo pagar contra entrega?',
]

describe('Lane C D8: a payment-info question that asks more goes to the model', () => {
  it('the code payment list answers only a plain how-to-pay question', () => {
    const big = decideInbound({ inboundText: 'Hola! Quiero un arnés, mido 1.66 y peso 63 kg. Soy de Alajuela, cuánto sería el total con envío y cómo puedo pagar?', brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.equal(big.shortcutKey ?? null, null)
    assert.equal(big.handoff, null)
    // Verifier r2 #2: a store that does not share payment data by chat still gets the payment-data review.
    const hidden = decideInbound({ inboundText: 'Hola, ¿cuánto sería el total con envío y cómo puedo pagar?', brandFacts: parseBrandFacts({ payment: { shareWithCustomers: false } }), shortcuts: SHORTCUTS })
    assert.notEqual(hidden.handoff, null)
    assert.equal(classifyPaymentText('¿Cómo puedo pagar?'), 'payment_info_safe')
    assert.equal(classifyPaymentText('¿Aceptan transferencia?'), 'payment_info_safe')
  })
})

describe('closed before-paying questions (Forge real-49 / real-61)', () => {
  it('are answered by the agent (never a payment hand-off), also inside a whole decision', () => {
    for (const t of SAFE) {
      assert.equal(isClosedPayInfoQuestion(t), true, t)
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.notEqual(d.paymentClass, 'payment_proof_or_risk', t)
      assert.equal(d.handoff, null, t)
    }
  })

  it('anything with a claim, a digit or a done word is not the closed shape', () => {
    for (const t of NOT_CLOSED) assert.equal(isClosedPayInfoQuestion(t), false, t)
    for (const t of ['Que le pongo de detalle? ya pagué', 'Se puede pagar cuando ya está acá? ya lo mandé', 'qué le pongo de detalle, ya hice el sinpe']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('the legacy worker keeps them payment-sensitive (Verifier r2 #4)', () => {
    for (const t of SAFE) assert.equal(isPaymentSensitiveText(t), true, t)
  })

  it('the "¿ya pagó?" model check is skipped only when everything unanswered is a closed question', () => {
    const hist = [
      { direction: 'inbound', content: 'Cual seria el número para hacer te un simpe' },
      { direction: 'outbound', content: 'Ana Mora\n8888-0000' },
    ]
    assert.equal(paymentCheckGate('Que le pongo de detalle', hist), false)
    assert.equal(paymentCheckGate('Listo, ya está', hist), true)
    // an earlier unanswered bubble with a claim keeps the check
    assert.equal(paymentCheckGate('Que le pongo de detalle', [...hist, { direction: 'inbound', content: 'ya lo hice' }]), true)
  })
})

describe('Lane C D2 / D8 round 3 (Forge exam 2026-10-22 21:00)', () => {
  const CTX = {
    catalog: [{ name: 'Arnés', price: 14900, stockLabel: 'disponible' }],
    shippingMethods: [{ name: 'Correos', price: 2500, coverage: 'todo el país', cod: 'no' }],
    orderFields: [],
    salesScript: '',
    aiDisclosure: 'discreet',
    paymentShareable: true,
    paymentDigits: [],
    promo: null,
    bundles: [],
    paymentMethods: ['sinpe'],
    stock: { soldOut: [], inStockNames: ['Arnés'] },
  } as unknown as SalesContext
  it('"simpe" and a split clitic read like the clean question', () => {
    for (const t of ['Cual seria el número para hacer te un simpe', 'Cual seria el número para hacer te un sinpe', 'cual seria el numero para hacerle un sinpi']) {
      assert.equal(isClosedPayInfoQuestion(t), true, t)
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    assert.equal(normalizePaySpelling('ya te hice el simpe'), 'ya te hice el sinpe')
  })
  it('a misspelled claim still hands off', () => {
    for (const t of ['ya le hice el simpe', 'Listo, ya mandé el simpe', 'te hice el sinpi', 'ya pagué por simpe']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
      assert.equal(isClosedPayInfoQuestion(t), false, t)
    }
  })
  it('"pago mañana y envío el comprobante" is not a receipt; a real receipt still is', () => {
    const ask = deriveSalesState({ history: [], inboundText: 'Lo quiero talla XL. ¿Puedo hacer el pago mañana y envío el comprobante?', ctx: CTX })
    assert.equal(ask.receiptCue, false)
    assert.notEqual(ask.stage, 'verificando')
    for (const t of ['Ahí te mando el comprobante', 'ya pagué, adjunto comprobante', 'comprobante']) {
      assert.equal(deriveSalesState({ history: [], inboundText: t, ctx: CTX }).receiptCue, true, t)
    }
  })
  it('an opinion / worry about paying goes to the model, not the method list', () => {
    for (const t of ['¿Qué es mejor, SINPE o tarjeta? No quiero dar mi tarjeta', '¿Es seguro pagar con tarjeta?']) {
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.shortcutKey ?? null, null, t)
      assert.equal(d.handoff, null, t)
    }
    assert.equal(classifyPaymentText('¿Qué métodos de pago tienen?'), 'payment_info_safe')
  })
})
