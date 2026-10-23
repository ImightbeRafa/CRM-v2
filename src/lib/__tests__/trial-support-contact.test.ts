/**
 * Betsy's own sales agent exam (2026-10-23): a trial question and a software-usage question are not payment claims; the
 * business's declared contact line is not a payment number. Real claims and payment destinations stay held.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/trial-support-contact.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, isClosedPayInfoQuestion } from '@/lib/soft-ai/payment-classifier'
import { paymentCheckGate } from '@/lib/soft-ai/payment-claim-check-core'
import { paymentNumberProblems } from '@/lib/soft-ai/payment-guard'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'

const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const CARD = { shareWithCustomers: true, methods: ['tarjeta'] as const }
const FACTS = parseBrandFacts({ payment: CARD, extraFacts: [{ label: 'Contacto', value: 'Soporte: hola@betsycrm.com, WhatsApp +506 6247-0831' }] })
const NO_CONTACT = parseBrandFacts({ payment: CARD })

describe('trial / software-usage questions are not payment claims', () => {
  it('answered by the agent, no payment hand-off', () => {
    for (const t of ['¿Puedo probarlo antes de pagar?', 'Hola, ¿puedo probarlo gratis antes de pagar?', '¿Hay prueba gratis?', 'Uso Betsy pero no sé cuáles pedidos ya confirmé', 'No sé cuáles pedidos ya confirmé', '¿Cómo veo qué pedidos ya confirmé?']) {
      assert.equal(isClosedPayInfoQuestion(t), true, t)
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS }) as { handoff: unknown }
      assert.equal(d.handoff, null, t)
    }
  })
  it('a real claim next to them still hands off', () => {
    for (const t of ['Ya pagué, ¿puedo probarlo?', 'No sé si ya confirmé el pago', 'Ya pagué el plan pero no sé cuáles pedidos ya confirmé', 'No sé cuáles pedidos ya confirmé, te mandé el comprobante']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
      assert.equal(paymentCheckGate(t, []), true, t)
    }
  })
})

describe('the declared contact line is not a payment number', () => {
  it('a support reply with the declared WhatsApp passes', () => {
    for (const t of ['Para soporte escribí a nuestro número de WhatsApp: +506 6247-0831 😊', 'Sobre el pago del plan, el equipo te ayuda por WhatsApp al +506 6247-0831', 'Pagás con tarjeta en la web. Dudas: WhatsApp +506 6247-0831']) {
      assert.deepEqual(paymentNumberProblems({ text: t, facts: FACTS }), [], t)
    }
  })
  it('fail closed: not declared, or right after a payment-destination word, is still held', () => {
    assert.deepEqual(paymentNumberProblems({ text: 'Para soporte escribí a nuestro número de WhatsApp: +506 6247-0831 😊', facts: NO_CONTACT }), ['payment_number_unsourced'])
    for (const t of ['Hacé el SINPE al 6247-0831', 'Depositá a la cuenta 6247-0831', 'Para pagar mandá la plata al +506 6247-0831', 'Hacé el pago al número +506 6247-0831', 'Para soporte escribí al número +506 8888-1234']) {
      assert.deepEqual(paymentNumberProblems({ text: t, facts: FACTS }), ['payment_number_unsourced'], t)
    }
  })
})

describe('Verifier #145: fail closed — any payment destination in the reply keeps the contact number held', () => {
  const WA = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '88881234', holderName: 'Ana' } }, extraFacts: [{ label: 'WhatsApp', value: '+506 6247-0831' }] })
  it('every bypass the Verifier found is held', () => {
    for (const t of [
      'Al 6247-0831 nos hacés el SINPE y listo',
      '+506 6247-0831 es nuestro número para SINPE Móvil.',
      'Podés pagar por SINPE Móvil al siguiente número:\n+506 6247-0831',
      'SINPE Móvil:\n6247-0831',
      'Datos para el pago\n6247-0831\nJuan Pérez',
      'Pagá por SINPE. Al 6247-0831',
      'Hacé la transferencia! 6247-0831',
      'El SINPE lo recibimos en el mismo número de WhatsApp de la tienda: +506 6247-0831',
      'Mandá los ₡15 000 al 6247-0831',
      '¿Te sirve SINPE? +506 6247-0831 a nombre de Juan Pérez',
    ]) assert.ok(paymentNumberProblems({ text: t, facts: WA }).includes('payment_number_unsourced'), JSON.stringify(t))
  })
  it('a label that also names payment is never a contact-only fact', () => {
    const mixed = parseBrandFacts({ payment: CARD, extraFacts: [{ label: 'Teléfono / SINPE', value: '+506 6247-0831' }] })
    assert.deepEqual(paymentNumberProblems({ text: 'Para soporte escribí a nuestro número de WhatsApp: +506 6247-0831 😊', facts: mixed }), ['payment_number_unsourced'])
  })
  it('a bare "prueba" is not a trial question (it can mean proof of payment)', () => {
    for (const t of ['Hay prueba', 'Tienen una prueba', 'Gracias. Tienen una prueba']) assert.equal(isClosedPayInfoQuestion(t), false, t)
    const hist = [{ direction: 'outbound', content: 'SINPE Móvil 8888-1234 a nombre de Juan. Cuando lo hagás mandame el comprobante' }]
    assert.equal(paymentCheckGate('Tienen una prueba', hist), true)
    assert.equal(isClosedPayInfoQuestion('¿Hay prueba gratis?'), true)
  })
})
