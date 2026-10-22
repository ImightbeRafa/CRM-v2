/**
 * Lane C Forge exam 2026-10-22 (real chats real-49 / real-61): closed before-paying questions are answered by the agent,
 * never handed off — "Que le pongo de detalle" (SINPE note) and "¿se puede pagar cuando ya está acá el producto?"
 * (cash on delivery). Real claims and pasted numbers keep the person path.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/closed-pay-info.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, isClosedPayInfoQuestion } from '@/lib/soft-ai/payment-classifier'
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
]

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
