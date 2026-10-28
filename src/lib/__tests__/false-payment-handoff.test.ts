/**
 * Rafael 2026-10-27 — false "Pago por verificar" hand-offs seen live (Sleeping / Forge / PatchHouse).
 * Every message here is a real customer message from the inbox; real payment claims stay with a person.
 *
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/false-payment-handoff.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText, hasHardPaymentClaim } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { deriveSalesState, type SalesContext } from '@/lib/soft-ai/sales-state'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import { customerTextsAfterDetails } from '@/lib/soft-ai/agent-turn'
import { escalationIsPaymentTalk } from '@/lib/soft-ai/llm/runtime'

const FACTS = parseBrandFacts({
  payment: { shareWithCustomers: true, methods: ['sinpe', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' } },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const DETAILS = 'Perfecto 🙌\nSINPE Móvil: 6201 9914\nA nombre de: Rafael García'

describe('price / how-to-order question with a typo is not a payment claim', () => {
  const fresia = 'Buenas noches!!\nQué costó tiene y como lo pudo pedir y pagar al llegar con tarjeta...\nQuedo atenta'

  it('classifies as a payment-info question, and the model answers all of it', () => {
    assert.equal(classifyPaymentText(fresia), 'payment_info_safe')
    const d = decideInbound({ inboundText: fresia, brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.equal(d.escalate, false)
    assert.equal(d.handled, false)
    assert.ok(d.decisionTrace.steps.some((s) => s.reason === 'asks_more_than_payment'))
  })

  it('a price question with no "?" is not a claim', () => {
    for (const t of ['Qué costó tiene', 'Cuanto costó el envío a Limón', 'como lo puedo pedir y pagar con tarjeta']) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('real claims still go to a person, also inside a question-shaped sentence', () => {
    for (const t of [
      // Verifier 2026-10-28 F1: "Hola cómo está" opens most CR messages; accented past verbs after it still count.
      'Hola cómo está, efectué la transferencia de 25.000',
      'Cuándo me envían el pedido, efectué la transferencia',
      'Hola como esta, rebotó la transferencia',
      'Hola cómo está, la transferencia se acreditó',
      'Hola cómo está, el banco aprobó la transferencia',
      'Buenas cómo le va, Juan realizó el sinpe',
      'Buenas como esta el pago se acreditó',
      'Como ya le pagué, cuando llega',
      'como le pagué ayer cuando me llega',
      'Mamá lo canceló',
      'Mi esposo se encargó del pago',
      'Cuanto costó el envío que ya pagué',
      'cómo hago si ya le mandé la plata',
      'Que ya le pasé la plata',
    ]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('an earlier bubble with a claim after a greeting still counts (Verifier F1 burst)', () => {
    for (const t of ['Hola cómo está, efectué el pago', 'Hola como esta, entregué el dinero', 'Hola cómo está, le entregué la plata al mensajero', 'Buenas cómo le va, Juan realizó el sinpe']) {
      assert.equal(hasHardPaymentClaim(t), true, t)
    }
  })
})

describe('done-bubble after the payment details counts only after the details', () => {
  const base = { brandFacts: FACTS, shortcuts: SHORTCUTS, paymentDetailsSent: true, earlierCustomerTexts: ['Sinpe'] }

  it('"Sinpe" (the choice the details answered) + "¿De cuánto sería el monto?" goes to the model', () => {
    const d = decideInbound({ ...base, inboundText: 'De cuando sería el monto?', afterDetailsCustomerTexts: [], unansweredCustomerTexts: [] })
    assert.equal(d.escalate, false)
    assert.equal(d.handled, false)
  })

  it('"Listo ✅" after the details is still a payment hand-off', () => {
    assert.equal(decideInbound({ ...base, inboundText: 'Listo ✅', afterDetailsCustomerTexts: [] }).escalate, true)
    assert.equal(decideInbound({ ...base, inboundText: '¿De cuánto era?', afterDetailsCustomerTexts: ['Listo'] }).escalate, true)
  })

  it('without the new input the old 10-minute window still applies (fail closed)', () => {
    assert.equal(decideInbound({ ...base, inboundText: 'De cuando sería el monto?' }).escalate, true)
  })
})

describe('the "Listo ✅" bubbles: last 10 min, after the first details of that window', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
  const h = (direction: 'inbound' | 'outbound', content: string, min: number) => ({ direction, content, sentAt: ago(min) })
  const decide = (history: ReturnType<typeof h>[], inboundText: string) =>
    decideInbound({
      inboundText,
      brandFacts: FACTS,
      shortcuts: SHORTCUTS,
      paymentDetailsSent: true,
      afterDetailsCustomerTexts: customerTextsAfterDetails(history),
      unansweredCustomerTexts: [],
    })

  it('an old "Listo" / "Por sinpe" / "Ok ya" never hands off a new question (Verifier F2 A–C, F)', () => {
    assert.equal(decide([h('outbound', DETAILS, 2880), h('inbound', 'Listo ✅', 2879), h('outbound', 'Pago recibido, gracias', 2870)], 'Hola, ¿cuándo me llega el pedido?').escalate, false)
    assert.equal(decide([h('outbound', DETAILS, 1440), h('inbound', 'Por sinpe', 1439)], '¿Tienen talla M del parche de energía?').escalate, false)
    assert.equal(decide([h('outbound', DETAILS, 60), h('inbound', 'Ok ya', 59)], '¿Cuánto cuesta el envío a Limón?').escalate, false)
    assert.equal(decide([h('outbound', DETAILS, 31), h('inbound', 'Listo ✅', 30), h('outbound', 'Apenas nos llegue te avisamos', 20)], 'Muchas gracias').escalate, false)
  })

  it('the choice before the details does not count; a "Listo" between two details bubbles does (F6 race)', () => {
    assert.equal(decide([h('inbound', 'Sinpe', 2), h('outbound', DETAILS, 2), h('outbound', 'Cuando lo hagás, mandame el comprobante', 2)], 'De cuando sería el monto?').escalate, false)
    assert.equal(decide([h('outbound', DETAILS, 3), h('inbound', 'Listo', 2), h('outbound', 'IBAN CR05 0152 0200 1026 2840 66', 2)], 'Gracias').escalate, true)
  })

  it('a returning customer: old details days ago, new details now, the fresh choice before them does not count', () => {
    assert.equal(decide([h('outbound', DETAILS, 4000), h('inbound', 'Sinpe', 2), h('outbound', DETAILS, 1)], '¿De cuánto es?').escalate, false)
    assert.equal(decide([h('outbound', DETAILS, 4000), h('inbound', 'Listo', 1)], 'Gracias').escalate, true)
  })
})

describe('model escalation → payment hand-off', () => {
  it('right after the details, anything but a thank-you is payment (Verifier F4)', () => {
    for (const t of ['Le acabo de mandar', 'Ahí le mandé', 'Le pasé', 'Envié', 'Mandé', 'Le hice', '¿Cuánto era?\nListo', 'Revise porfa']) {
      assert.equal(escalationIsPaymentTalk(t, DETAILS), true, t)
    }
    assert.equal(escalationIsPaymentTalk('Muchas gracias', DETAILS), false)
  })

  it('a store payment MENTION (not the details) alone does not make "gracias" / "guía de tallas" a payment', () => {
    const mention = '¡Con gusto! Cuando hagás el pago, mandame el comprobante por aquí.'
    assert.equal(escalationIsPaymentTalk('Muchas gracias', mention), false)
    assert.equal(escalationIsPaymentTalk('Guía de tallas', mention), false)
    assert.equal(escalationIsPaymentTalk('Listo', mention), true)
    assert.equal(escalationIsPaymentTalk('Ya pagué', ''), true)
  })
})

describe('after the receipt the agent stops asking for the payment', () => {
  const CTX: SalesContext = {
    catalog: [{ name: 'GLP-1 Patch', price: 14900, stockLabel: 'agotado' }],
    shippingMethods: [{ name: 'Envío a domicilio', price: 3000, coverage: 'GAM', cod: 'no' }],
    orderFields: ['Nombre', 'Teléfono'],
    salesScript: '',
    aiDisclosure: 'discreet',
    paymentShareable: true,
    paymentDigits: ['62019914'],
    promo: null,
  }
  const at = (i: number) => new Date(Date.UTC(2026, 9, 26, 12, i)).toISOString()
  const msg = (i: number, direction: 'inbound' | 'outbound', content: string): SoftAiHistoryMessage => ({ id: `m${i}`, direction, content, sentAt: at(i) })

  it('receipt photo after the details → post-sale step (no "mandame el comprobante")', () => {
    const history = [
      msg(1, 'outbound', DETAILS),
      msg(2, 'inbound', '[image]'),
      msg(3, 'outbound', '¡Hola! Mi nombre es Nathalia 😊 Claro apenas nos llegue te estaremos avisando.'),
    ]
    const s = deriveSalesState({ history, inboundText: 'Muchas gracias', ctx: CTX })
    assert.equal(s.stage, 'esperando_comprobante')
    assert.match(s.nextStep, /YA pagó/)
  })

  it('the store confirming the payment counts too', () => {
    const history = [msg(1, 'outbound', DETAILS), msg(2, 'outbound', 'Pago recibido, ¡gracias! Ya va tu pedido.')]
    assert.match(deriveSalesState({ history, inboundText: 'Gracias!', ctx: CTX }).nextStep, /YA pagó/)
  })

  it('no receipt yet → still waiting, with the courtesy rule', () => {
    const s = deriveSalesState({ history: [msg(1, 'outbound', DETAILS)], inboundText: 'Muchas gracias', ctx: CTX })
    assert.doesNotMatch(s.nextStep, /YA pagó/)
    assert.match(s.nextStep, /Si solo agradece/)
  })

  it('a promise, a question, a refund, a promise from the store or a new sale is not "paid" (Verifier F5)', () => {
    for (const later of ['Ok, ahorita le mando el comprobante', '¿A este número le mando el comprobante?', '¿Me devuelven la plata?']) {
      assert.doesNotMatch(deriveSalesState({ history: [msg(1, 'outbound', DETAILS), msg(2, 'inbound', later)], inboundText: 'ok', ctx: CTX }).nextStep, /YA pagó/, later)
    }
    const promise = [msg(1, 'outbound', DETAILS), msg(2, 'outbound', 'Cuando lo hagás, mandame el comprobante y te confirmamos el pago 🙌')]
    assert.doesNotMatch(deriveSalesState({ history: promise, inboundText: 'Gracias', ctx: CTX }).nextStep, /YA pagó/)
    const second = [msg(1, 'outbound', DETAILS), msg(2, 'inbound', '[image]'), msg(3, 'inbound', 'Ah y también quiero el Energy Patch'), msg(4, 'outbound', 'El Energy Patch cuesta ₡12 900')]
    assert.doesNotMatch(deriveSalesState({ history: second, inboundText: 'Sí porfa', ctx: CTX }).nextStep, /YA pagó/)
  })

  it('a receipt from BEFORE the latest details does not count', () => {
    const history = [msg(1, 'outbound', DETAILS), msg(2, 'inbound', '[image]'), msg(3, 'outbound', DETAILS)]
    assert.doesNotMatch(deriveSalesState({ history, inboundText: 'ok', ctx: CTX }).nextStep, /YA pagó/)
  })
})

describe('wiring (source)', () => {
  const runtime = readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8')
  const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')

  it('a model escalation uses the payment-talk rule', () => {
    assert.match(runtime, /structured\.needsHuman && customerPaymentTalk/)
    assert.match(runtime, /const customerPaymentTalk = escalationIsPaymentTalk\(customerSide, lastStoreText\)/)
    assert.doesNotMatch(runtime, /structured\.needsHuman && \(hasPaymentWord\(customerSide\) \|\| hasPaymentWord\(lastStoreText\)\)/)
  })

  it('the payment check fails closed on error after the details, and before them only with customer money words', () => {
    assert.match(turn, /result\.verdict === 'error' &&\s*!dataChoicePath &&\s*input\.paymentDetailsSent !== true &&\s*!unansweredPaymentState\(/)
  })

  it('live and Probar pass the bubbles after the details', () => {
    assert.equal(turn.match(/afterDetailsCustomerTexts: \[\.\.\.customerTextsAfterDetails\(history\)/g)?.length, 2)
  })
})
