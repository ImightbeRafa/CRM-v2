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
    for (const t of ['Para soporte escribí a nuestro número de WhatsApp: +506 6247-0831 😊', 'Para soporte escribí a nuestro número de WhatsApp: +506 6247-0831', 'Nuestro número de soporte es +506 6247-0831', 'Escribinos al WhatsApp 6247-0831, te ayudamos con la configuración']) {
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

describe('SecureDog #145: safe minimum — the contact line is exempt only for an agent with no number-based payment', () => {
  it('a SINPE / transfer store never gets the exemption, whatever the reply', () => {
    const sinpeStore = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '62019914', holderName: 'Tienda SA' } }, extraFacts: [{ label: 'WhatsApp', value: '8701-2233' }] })
    for (const t of ['Escribinos al WhatsApp 8701-2233 😊', 'Datos para el SINPE:\n- Número: 8701 2233\n- A nombre de: Tienda SA', '¡Perfecto!\nSINPE Móvil\n8701 2233', 'Al 8701-2233 por SINPE Móvil y me mandás el comprobante']) {
      const r = paymentNumberProblems({ text: t, facts: sinpeStore })
      if (/sinpe|pag|n[uú]mero/i.test(t)) assert.ok(r.includes('payment_number_unsourced'), JSON.stringify(t))
    }
  })
  it('card-only store: payment-framed replies with the contact number are held', () => {
    for (const t of ['Hacé el SINPE. Número: +506 6247-0831', 'Datos para el pago:\n6247 0831', 'Hacé el simpe al número +506 6247-0831', 'Hacé el S-I-N-P-E al número +506 6247-0831', 'Transfiera al número +506 6247-0831', 'Abonás al número +506 6247-0831', 'Podés cancelar el total al número +506 6247-0831', 'Págame al número +506 6247-0831']) {
      assert.ok(paymentNumberProblems({ text: t, facts: FACTS }).includes('payment_number_unsourced'), JSON.stringify(t))
    }
    // Verifier #145 round 3: with any payment / money stem the contact number is held too (fail closed).
    for (const t of ['Sobre el pago del plan, el equipo te ayuda por WhatsApp al +506 6247-0831', 'Pagás con tarjeta en la web. Dudas: WhatsApp +506 6247-0831']) {
      assert.ok(paymentNumberProblems({ text: t, facts: FACTS }).includes('payment_number_unsourced'), JSON.stringify(t))
    }
    const planted = parseBrandFacts({ payment: CARD, extraFacts: [{ label: 'Atención', value: 'SINPE Móvil 8888-1234 a nombre de Juan' }] })
    assert.ok(paymentNumberProblems({ text: 'Para dudas, nuestro número es 8888-1234', facts: planted }).includes('payment_number_unsourced'))
  })
})

describe('Verifier / SecureDog #145 round 3: closed shape — payment stems anywhere, contact frame on the number', () => {
  const N = '+506 6247-0831'
  const CASH = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['efectivo'] }, extraFacts: [{ label: 'WhatsApp', value: '8701-2233' }] })
  const NONE = parseBrandFacts({ extraFacts: [{ label: 'WhatsApp', value: '8701-2233' }] })
  it('every payment phrasing with the contact number is held (card-only store)', () => {
    for (const t of [
      `El número para el pago es ${N}`,
      `Para pagar, usá el número ${N}`,
      `Pagos: ${N}`,
      `Pago: ${N}`,
      `Para el pago: ${N}`,
      `Podés pagarnos en el ${N}`,
      `Pagás con el número ${N}`,
      `Método de pago: número ${N}`,
      `El pago va a ${N}`,
      `Hacé el pago en el número de WhatsApp ${N}`,
      `Hacé el pago por medio del número ${N}`,
      `Número para pagos: ${N}`,
      `¿Querés pagar ya? Número: ${N}`,
      `Pagas por medio de nuestro WhatsApp ${N}`,
      `Pagás con tarjeta. Si preferís, también al número ${N}`,
      `Podés pagar con tarjeta.\nO al número ${N} y listo`,
      `Pagos por SinpeMóvil: ${N}`,
      `Pagá por Sinpemovil ${N}`,
      `Hacé el Sínpe al número ${N}`,
      `Págalo al número ${N}`,
      `Págalo a este número: ${N}`,
      `Hacé el S I N P E al número ${N}`,
      `Hacé el SIN\u200bPE al número ${N}`,
      `Pasame la platica al número ${N}`,
      `Pasame los rojos al número ${N}`,
      `Hacé los 2 sinpes al número ${N}`,
      `Hacé el sinpi al número ${N}`,
      `Hacé el cinpe al número ${N}`,
      `Te paso el número para pagar: ${N}`,
      `Enviá los 15 mil al número ${N}`,
      `Deposíteme al número ${N}`,
      `Mándame la platita al número ${N}`,
    ]) assert.ok(paymentNumberProblems({ text: t, facts: FACTS }).includes('payment_number_unsourced'), JSON.stringify(t))
  })
  it('cash-only and unconfigured stores: the same', () => {
    for (const facts of [CASH, NONE]) {
      assert.ok(paymentNumberProblems({ text: 'Para pagar, usá el número 8701-2233', facts }).includes('payment_number_unsourced'))
      assert.deepEqual(paymentNumberProblems({ text: 'Escribinos a nuestro número de WhatsApp 8701-2233', facts }), [])
    }
  })
  it('the number must sit in a contact frame', () => {
    assert.ok(paymentNumberProblems({ text: `Nuestro número es ${N}`, facts: FACTS }).includes('payment_number_unsourced'))
  })
  it("SecureDog L2: a contact fact whose value names money (e.g. 'cuenta') never exempts — use a WhatsApp-only fact", () => {
    const betsyLike = parseBrandFacts({ payment: CARD, extraFacts: [{ label: 'Contacto', value: `Clientes con cuenta: soporte en la app. WhatsApp ${N}` }] })
    assert.ok(paymentNumberProblems({ text: `Para soporte escribí a nuestro número de WhatsApp: ${N}`, facts: betsyLike }).includes('payment_number_unsourced'))
    const own = parseBrandFacts({ payment: CARD, extraFacts: [{ label: 'WhatsApp', value: N }] })
    assert.deepEqual(paymentNumberProblems({ text: `Para soporte escribí a nuestro número de WhatsApp: ${N}`, facts: own }), [])
  })
})
