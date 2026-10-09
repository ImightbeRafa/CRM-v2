/**
 * AL2-A1 payment classifier (A1.1–A1.3).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyPaymentText } from '../soft-ai/payment-classifier'
import { decideInbound } from '../soft-ai/inbound-decision'
import { parseBrandFacts, type BrandFacts } from '../soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '../soft-ai/shortcuts'
import { runA1Tool } from '../soft-ai/llm/tool-runner'

const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({
  ...row,
  isActive: true,
  sortOrder: index,
}))

function sharedFacts(share: boolean): BrandFacts {
  return parseBrandFacts({
    schemaVersion: 1,
    payment: {
      shareWithCustomers: share,
      methods: ['sinpe'],
      sinpe: { number: '88881234', holderName: 'Tienda' },
    },
  })
}

describe('classifyPaymentText', () => {
  it('A1.1 payment questions are info-safe', () => {
    assert.equal(classifyPaymentText('¿cómo puedo pagar?'), 'payment_info_safe')
    assert.equal(classifyPaymentText('¿Cuáles son las formas de pago?'), 'payment_info_safe')
  })

  it('A1.3 proof, confirmation, refund, and bare pago stay human', () => {
    for (const text of [
      'ya le hice el SINPE, le mando el comprobante',
      '¿me confirman si ya llegó?',
      'quiero un reembolso',
      'pago',
    ]) {
      assert.equal(classifyPaymentText(text), 'payment_proof_or_risk', text)
    }
  })
})

describe('decideInbound payment policy', () => {
  it('A1.1 shared facts render sys_payment_info without a model call', () => {
    const decision = decideInbound({
      inboundText: '¿cómo puedo pagar?',
      brandFacts: sharedFacts(true),
      shortcuts,
    })
    assert.equal(decision.paymentClass, 'payment_info_safe')
    assert.equal(decision.escalate, false)
    assert.equal(decision.shortcutKey, 'sys_payment_info')
    assert.equal(decision.intent, 'payment_info')
    assert.equal(decision.needsHuman, false)
    assert.match(decision.text, /88881234/)
    assert.equal(decision.decisionTrace.steps.some((step) => step.step === 'model'), false)
  })

  it('A1.2 hidden facts hand off with payment_info_not_shared', () => {
    const decision = decideInbound({
      inboundText: '¿cómo puedo pagar?',
      brandFacts: sharedFacts(false),
      shortcuts,
    })
    assert.equal(decision.shortcutKey, 'sys_handoff_payment')
    assert.equal(decision.escalate, true)
    assert.ok(decision.reasons.includes('payment_info_not_shared'))
    // 2026-10-09 (Rafael): the client never hears "una persona del equipo" — seller voice.
    assert.match(decision.text, /lo reviso/)
    assert.doesNotMatch(decision.text, /persona|equipo/i)
  })

  it('A1.3 proof class blocks tools other than escalate', async () => {
    const blocked = await runA1Tool(
      {
        tenantId: 't',
        conversationId: 'c',
        socialAccountId: 's',
        peerId: 'p',
        enabledTools: ['search_inventory', 'escalate_to_human', 'use_shortcut'],
        paymentClassification: 'payment_proof_or_risk',
        inboundText: 'pago',
      },
      'search_inventory',
      '{"query":"kit"}',
    )
    assert.equal(blocked.name, 'escalate_to_human')
    assert.equal(blocked.escalateReason, 'payment_or_sinpe')
  })
})

// INT-76 (SecureDog 2026-10-09): claims phrased as questions, without "ya", refunds and "por error" stay human.
it('payment claims / refunds as questions stay with a person', () => {
  for (const text of [
    '¿ya te llegó mi sinpe?', '¿recibieron el pago?', '¿ya tienen mi pago?', '¿se reflejó el sinpe?',
    'hice el sinpe, ¿cuándo sale?', 'hice el pago, ¿cuándo me lo envían?', 'te pasé el sinpe, ¿está bien?',
    'el sinpe que te mandé es de 14900, ¿está bien?', 'mi pago no aparece, ¿qué hago?', '¿me devuelven la plata del pago?',
    'Hola, hice un sinpe por error, ¿me lo pueden devolver?', 'sinpe?', 'Hola cómo están, hice el sinpe',
    'pagué, ¿lo podés revisar?', 'te pagué', 'deposité 14900', 'pagado?', '¿le llegó la transferencia?',
    'me rebajaron dos veces de la tarjeta', 'me descontaron de más de la cuenta',
    // INT-81: charge complaints and refund requests always reach a person.
    'Hay un cargo de más en mi tarjeta', 'el mensajero me cobró ₡2000 de envío y era gratis',
    'quiero devolver el producto y que me regresen la plata', 'quiero la devolución, ya no lo quiero, devuélvanme todo',
    'no me llegó y quiero que me devuelvan', 'el cobro salió doble', 'me hicieron un doble cargo', 'quiero que me reintegren el dinero',
    // INT-82: Costa Rican "cancelar" = pay, "pasar la plata", an amount said to be received; INT-81 leftovers.
    'Ya cancelé', 'ya cancelé el monto', 'Ya está cancelado el pedido', 'Le acabo de pasar la plata', '¿Recibiste los ₡14900?',
    'me han cobrado de más', '¿puedo devolverlo? quiero que me regresen lo que di',
    'Ya cancelé, ¿me lo mandan hoy?', '¿les llegaron los 15 mil?', '¿Pueden devolverme lo que di?', 'Hola, ¿puedo devolverlo y que me devuelvan lo que di?',
  ]) {
    assert.equal(classifyPaymentText(text), 'payment_proof_or_risk', text)
  }
})

it('explicit how / can-I-pay questions are still answered by the agent', () => {
  for (const text of [
    'seria con envio puedo pagar cuando lo recibo?', 'se puede pagar contra entrega?', '¿puedo pagar en efectivo?',
    '¿cuándo se paga?', '¿se puede pagar con sinpe?', '¿reciben sinpe?', '¿tienen sinpe?', '¿tienen talla XL?',
    // Verifier 2026-10-09: ordinary pre-sale questions never hand off.
    '¿Cuánto me cobran por el envío?', '¿Me cobran el envío a Cartago?', '¿Puedo devolverlo si no me queda la talla?',
    '¿Hacen devoluciones o cambios?', 'Perdón, te escribí por error', '¿El envío tarda de más de 3 días?',
    'me mandaron una talla de más', '¿hay cobro extra por envío?', '¿tienen descuento?', '¿Se pueden hacer cambios de talla?',
    'Hola, ¿puedo devolverlo si no me queda?', '¿tienen alguno de 10 mil?', '¿Cuánto sale con envío a Heredia?',
    '¿Ya les llegaron las camisas de ₡8000?', '¿Llegó la talla M de 12 mil?', '¿La promo fue cancelada?', '¿Cómo cancelo?', '¿Si cancelo hoy me llega mañana?', '¿Les llegó mercadería nueva?',
  ]) {
    assert.notEqual(classifyPaymentText(text), 'payment_proof_or_risk', text)
  }
})

it('INT-82: confirmation wording also blocks "gracias por tu pago" / "ya tenemos tu pago" / "ya enviamos tu pedido"', async () => {
  const { hasConfirmationWording } = await import('../soft-ai/shortcuts')
  for (const t of ['¡Gracias por tu pago! Ya preparamos tu pedido 😊', 'Gracias, ya tenemos tu pago', 'Tu pedido ya está listo, ya enviamos tu pedido']) {
    assert.equal(hasConfirmationWording(t), true, t)
  }
  assert.equal(hasConfirmationWording('¡Gracias por tu compra! Cualquier cosa me escribís.'), false)
  for (const t of ['¡Perfecto, gracias! Ya te lo enviamos mañana.', 'Tu pedido ya está en proceso de envío.']) {
    assert.equal(hasConfirmationWording(t), true, t)
  }
  // Ordinary shipping explanations are never blocked (SecureDog 2026-10-09).
  for (const t of ['Si pagás hoy, enviamos tu pedido mañana.', 'Enviamos el pedido por Correos.', 'Despachamos tu pedido de lunes a viernes.', 'Mandamos el pedido con mensajero.', 'Cuando me pasés la dirección, preparamos tu pedido.', 'Te enviamos el pedido apenas se revise el pago.']) {
    assert.equal(hasConfirmationWording(t), false, t)
  }
})
