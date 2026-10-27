/**
 * Rafael 2026-10-27 — false "Pago por verificar" hand-offs seen live (Sleeping / Forge / PatchHouse).
 * Every message here is a real customer message from the inbox; real payment claims stay with a person.
 *
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/false-payment-handoff.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { deriveSalesState, type SalesContext } from '@/lib/soft-ai/sales-state'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

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

  it('a receipt from BEFORE the latest details does not count', () => {
    const history = [msg(1, 'outbound', DETAILS), msg(2, 'inbound', '[image]'), msg(3, 'outbound', DETAILS)]
    assert.doesNotMatch(deriveSalesState({ history, inboundText: 'ok', ctx: CTX }).nextStep, /YA pagó/)
  })
})

describe('wiring (source)', () => {
  const runtime = readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8')
  const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')

  it('a model escalation is a payment hand-off only on the customer\'s own payment words', () => {
    assert.match(runtime, /structured\.needsHuman && customerPaymentTalk/)
    assert.doesNotMatch(runtime, /structured\.needsHuman && \(hasPaymentWord\(customerSide\) \|\| hasPaymentWord\(lastStoreText\)\)/)
  })

  it('the payment check fails closed on error only with money words from the customer', () => {
    assert.match(turn, /result\.verdict === 'error' && !dataChoicePath && !unansweredPaymentState\(/)
  })

  it('live and Probar pass the bubbles after the details', () => {
    assert.equal(turn.match(/afterDetailsCustomerTexts: \[\.\.\.customerTextsAfterDetails\(history\)/g)?.length, 2)
  })
})
