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
import { escalationIsPaymentTalk, openPaymentDetails } from '@/lib/soft-ai/llm/runtime'

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

  it('once details were sent, a claim with no money word stays payment even after a later store message (Verifier r2 F1)', () => {
    const later = '1-2 días hábiles 😊 Cuando hagás el pago, mandame el comprobante'
    for (const t of ['Le acabo de mandar', 'Sí', 'Claro que sí', 'Así es', 'Sí, hace un rato', 'Hace un rato', '👍', 'Ok', 'Dale']) {
      assert.equal(escalationIsPaymentTalk(t, later, true), true, t)
      assert.equal(escalationIsPaymentTalk(t, '¿Pudiste hacer el SINPE al 6201 9914?'), true, t)
    }
    for (const t of ['Muchas gracias', 'Gracias 🙏', 'Mil gracias, muy amable']) {
      assert.equal(escalationIsPaymentTalk(t, later, true), false, t)
    }
  })

  it('a finished or old sale is not open payment details (Verifier r3 F1)', () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    const m = (direction: 'inbound' | 'outbound', content: string, min: number) => ({ id: content, direction, content, sentAt: ago(min) })
    assert.equal(openPaymentDetails([m('outbound', DETAILS, 30), m('inbound', 'Le acabo de mandar', 5)]), true)
    assert.equal(openPaymentDetails([m('outbound', DETAILS, 300), m('inbound', '[image]', 290), m('outbound', '¡Con gusto! Tu pedido sale mañana 😊', 280)]), false)
    assert.equal(openPaymentDetails([m('outbound', DETAILS, 300), m('outbound', 'Pago recibido ✅ ¡Gracias!', 200)]), false)
    assert.equal(openPaymentDetails([m('outbound', DETAILS, 8 * 24 * 60), m('outbound', 'Hola 😊 ¿En qué te ayudo?', 10)]), false)
    // Verifier r4 F2: a late payer (details 4 days ago) is still open.
    assert.equal(openPaymentDetails([m('outbound', DETAILS, 4 * 24 * 60), m('outbound', '¿Pudiste hacer el SINPE?', 10)]), true)
    const done = [m('outbound', DETAILS, 300), m('inbound', '[image]', 290), m('outbound', 'Tu pedido sale mañana', 280)]
    for (const t of ['Guía de tallas', '¿Cuándo me llega?', '¿Tienen talla M?']) {
      assert.equal(escalationIsPaymentTalk(t, 'Tu pedido sale mañana', openPaymentDetails(done)), false, t)
    }
  })

  it('money / yes emoji and CR yes-words are not a thank-you (Verifier r3 F2)', () => {
    for (const t of ['Gracias 🧾', 'Gracias 💸', 'Mil gracias 💰', 'Gracias 💳', 'Gracias 📸', 'Gracias 👍', 'Pura vida 👍', 'Pura vida', 'Mil']) {
      assert.equal(escalationIsPaymentTalk(t, 'Cuando hagás el pago, mandame el comprobante', true), true, t)
    }
    for (const t of ['Gracias 🙏', 'Mil gracias 😊', 'Muchas gracias ❤️']) {
      assert.equal(escalationIsPaymentTalk(t, 'Cuando hagás el pago, mandame el comprobante', true), false, t)
    }
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

  it('Verifier r2 F2: promises are not paid; a confirmation with ₡ keeps post-sale; the latest receipt wins', () => {
    for (const later of ['Le mandaré el comprobante', 'El comprobante se lo mando en la noche', 'Transfiero hoy y envío comprobante', 'Orita mando comprobante', 'Me confirma a qué número envío el comprobante', 'Al rato le transfiero y mando comprobante', 'Comprobante en la tarde']) {
      assert.doesNotMatch(deriveSalesState({ history: [msg(1, 'outbound', DETAILS), msg(2, 'inbound', later)], inboundText: 'ok', ctx: CTX }).nextStep, /YA pagó/, later)
    }
    const confirmed = [msg(1, 'outbound', DETAILS), msg(2, 'inbound', '[image]'), msg(3, 'outbound', 'Recibimos tu pago de ₡17 900, ¡gracias!')]
    assert.match(deriveSalesState({ history: confirmed, inboundText: '¿Cuándo me llega?', ctx: CTX }).nextStep, /YA pagó/)
    const twoOrders = [
      msg(1, 'outbound', DETAILS),
      msg(2, 'inbound', '[image]'),
      msg(3, 'inbound', 'Ah y también quiero el Energy Patch'),
      msg(4, 'outbound', 'El Energy Patch cuesta ₡12 900'),
      msg(5, 'inbound', '[image]'),
    ]
    assert.match(deriveSalesState({ history: twoOrders, inboundText: 'Muchas gracias', ctx: CTX }).nextStep, /YA pagó/)
  })

  it('captioned / document receipts with other store confirmations count (Verifier r4 F1)', () => {
    for (const [receipt, store] of [
      ['Listo ✅', '¡Recibido! 🙌 Sale mañana'],
      ['Ahí está', 'Confirmado ✅ ¡gracias!'],
      ['comprobante_sinpe.pdf', 'Recibido, gracias 🙌'],
      ['Listo', 'Ya nos llegó 🙌 gracias'],
      ['Ya está', 'Perfecto, ya lo vi. Sale mañana'],
    ]) {
      const history = [msg(1, 'outbound', DETAILS), msg(2, 'inbound', receipt), msg(3, 'outbound', store)]
      assert.match(deriveSalesState({ history, inboundText: '¿Cuándo me llega?', ctx: CTX }).nextStep, /YA pagó/, store)
    }
  })

  it('a failed, negated, partial or misdirected payment is not "paid" (Verifier r3 F3)', () => {
    for (const later of ['No he pagado', 'Todavía no he pagado', 'Me rechazó la tarjeta', 'Le hice el sinpe pero me salió rechazado', 'Ya le pagué a otro número por error', 'Ya pagué pero a la cuenta vieja', 'Se me cobró doble', 'Ya le pagué la mitad']) {
      assert.doesNotMatch(deriveSalesState({ history: [msg(1, 'outbound', DETAILS), msg(2, 'inbound', later)], inboundText: 'ok', ctx: CTX }).nextStep, /YA pagó/, later)
    }
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
    assert.match(runtime, /const customerPaymentTalk = escalationIsPaymentTalk\(customerSide, lastStoreText, openPaymentDetails\(input\.history\)\)/)
    assert.doesNotMatch(runtime, /structured\.needsHuman && \(hasPaymentWord\(customerSide\) \|\| hasPaymentWord\(lastStoreText\)\)/)
  })

  it('the payment check fails closed on error after the details, and before them only with customer money words', () => {
    assert.match(turn, /result\.verdict === 'error' &&\s*!dataChoicePath &&\s*input\.paymentDetailsSent !== true &&\s*!unansweredPaymentState\(/)
  })

  it('the error bypass also needs every unanswered bubble to be courtesy or a question (Verifier r4 a)', () => {
    assert.match(turn, /\.every\(\(t\) => !t\?\.trim\(\) \|\| isCourtesyText\(t\) \|\| \/\[\?¿\]\/u\.test\(t\)\)/)
  })

  it('live and Probar pass the bubbles after the details', () => {
    assert.equal(turn.match(/afterDetailsCustomerTexts: \[\.\.\.customerTextsAfterDetails\(history\)/g)?.length, 2)
  })
})

/** Rafael 2026-10-28 — DeepSleep 7-day review: three wording-only false hand-offs left after the first fix. */
describe('false payment hand-offs, round 2 (real messages)', () => {
  it('an emoji with its style character is not a payment claim ("Excelente, gracias ☺️", "Muchas gracias ❤️")', () => {
    for (const t of ['Excelente, gracias ☺️', 'Por favor ☺️', 'Muchas gracias ❤️', 'gracias ✌️', '☺️', '🤷‍♂️']) {
      assert.equal(hasHardPaymentClaim(t, {}), false, t)
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('real claims with the same emoji, and disguised letters, still go to a person', () => {
    for (const t of ['Ya pagué ❤️', 'Listo, ya le hice el SINPE ☺️', 'ya pa️gué', 'Yа lе hicе еl sinpе', 'Ya раցսе́', 'Listo, pagado ❤️', 'Listo, pagado gracias', 'pagado, muchas gracias 😊', 'pagado ❤️']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('"Tarjeta contra entrega :)" is the contra-entrega choice; claims with a card stay with a person', () => {
    assert.equal(classifyPaymentText('Tarjeta contra entrega :)'), 'non_payment')
    for (const t of ['Ya pagué con tarjeta :)', 'Listo, tarjeta', 'Tarjeta ✅', 'tarjeta contra entrega 12000']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('"¿Cuál es el proceso de pago?" asks how to pay; "ya hice el proceso de pago" is a claim', () => {
    for (const t of ['¿Cuál es el proceso de pago?', 'Cual es el proceso de compra', '¿Cómo es el proceso para pagar?', 'El pago cm se maneja ?', '¿Qué opciones de pago tienen?', 'Buenas me gustaría saber el precio y qué opciones de envío / pago tienen']) {
      assert.equal(classifyPaymentText(t), 'payment_info_safe', t)
    }
    for (const t of ['Ya hice el proceso de pago', 'Ya terminé el proceso de pago ✅', 'El proceso de pago ya quedó', 'El pago ya se hizo, cómo se maneja el pago?', 'Ya le pagué con sinpe o efectivo?']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
})

describe('verifier 2026-10-28 round 2', () => {
  it('stays fast on a 4 KB whitespace run (the "pagado" rule is never widened)', () => {
    const s = 'pagado' + ' '.repeat(4000) + 'x'
    const t0 = performance.now()
    classifyPaymentText(s)
    hasHardPaymentClaim(s, {})
    assert.ok(performance.now() - t0 < 2000, `${Math.round(performance.now() - t0)} ms`)
  })

  it('the new how-to-pay phrases never cover a part payment, a debt or a refund', () => {
    for (const t of ['¿Cuál es el proceso de pago de la otra mitad?', '¿cómo se maneja el pago del saldo pendiente?', '¿cuál es el proceso de pago? quiero mi plata de vuelta']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
})

describe('SecureDog 2026-10-28 (INT-238 / INT-240)', () => {
  it('INT-238: invisible marks after digits or letters still hand off; only an emoji\'s own selector is ignored', () => {
    const F = '️'
    for (const t of [`Le mandé 1${F}5${F}0${F}0${F}0${F}, ¿cuándo me llega?`, `15${F}0${F}00`, 'Le mandé 1͏5000, ¿cuándo llega?', `pa${F}gué`]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', JSON.stringify(t))
    }
    for (const t of ['Excelente, gracias ☺️', '🤷‍♂️', 'Muchas gracias ❤️']) assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })

  it('INT-240: a part payment or debt next to the new how-to-pay phrases goes to a person', () => {
    for (const t of ['¿Cuál es el proceso de pago si mi esposo puso la mitad?', '¿Cómo se maneja el pago si mi esposo les dio la mitad al mensajero?', '¿Qué opciones de pago hay para lo que debo?', '¿Cuánto falta y cuál es el proceso de pago si mi esposo puso la mitad?']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
})

describe('verifier 2026-10-28 round 3: an emoji inside a claim', () => {
  it('a claim with an emoji in the middle of a word or sentence still hands off', () => {
    for (const t of ['Le mandé ❤️ 15 mil', 'pagu❤️é', 'ya pagado ✌️', 'Ya pa❤gué', 'Ya le hi❤ce el sin❤pe, ¿cuándo llega?']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['¿Cuánto cuesta? 😊', 'Quiero 2 bolsas ❤️', 'Hola 👋 ¿precio?']) assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })
})

describe('SecureDog 2026-10-28 round 2 (INT-240 / INT-238)', () => {
  it('the new how-to-pay questions are whole-message shapes: anything riding along goes to a person', () => {
    for (const t of ['¿Cuál es el proceso de pago si la señora le dejo la plata al mensajero?', '¿Cuál es el proceso de pago si mi hermana entrego la plata?', '¿Cómo se maneja el pago si Juan metio la plata en la cuenta?', '¿Cuál es el proceso de pago si mi mamá les consigno la plata?', '¿Cómo se maneja el pago? ¿Qué pasa si lo hice dos veces?', '¿Cuál es el proceso de pago? ✅', '¿Cuál es el proceso de pago? 💸']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['Hola, ¿cómo se maneja el pago?', '¿Cuál es el proceso de pago? 😊', '¿Cuál es el proceso de pago? 🙏🏻', '¿Qué opciones de pago tienen? ☺️']) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('an emoji with its selector inside a word or an amount still hands off', () => {
    for (const t of ['Ya pa❤️gué', 'Ya le hi❤️ce el sin❤️pe, ¿cuándo llega?', 'Le mandé 1❤️5❤️0❤️0❤️0❤️, ¿cuándo me llega?']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
})
