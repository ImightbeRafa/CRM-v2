/**
 * Lane C Forge exam 2026-10-22 (real chats real-49 / real-61): closed before-paying questions are answered by the agent,
 * never handed off — "Que le pongo de detalle" (SINPE note) and "¿se puede pagar cuando ya está acá el producto?"
 * (cash on delivery). Real claims and pasted numbers keep the person path.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/closed-pay-info.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, isCardByChatOffer, isClosedPayInfoQuestion, normalizePaySpelling } from '@/lib/soft-ai/payment-classifier'
import { deriveSalesState, type SalesContext } from '@/lib/soft-ai/sales-state'
import { paymentCheckGate, unansweredPaymentState } from '@/lib/soft-ai/payment-claim-check-core'
import { readFileSync } from 'node:fs'
const read = (p: string) => readFileSync(p, 'utf8')
import { isPaymentSensitiveText } from '@/lib/soft-ai/config'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
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
      // SecureDog r3: a card offer with no card block on file gets the payment-data review, never a payment hand-off.
      if (isCardByChatOffer(t)) assert.equal(d.handoff?.kind, 'review', t)
      else assert.equal(d.handoff, null, t)
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

describe('SecureDog r2 F1 / F2 (closed-question exemption, card by chat)', () => {
  const ch = (...codes: number[]) => String.fromCharCode(...codes)
  const CLAIMS = [
    `Vivo en Heredia ya${ch(0x2028)}pague. ¿Me pasás el número?`,
    `Vivo en Heredia ya${ch(0x2029)}pague. ¿Me pasás el número?`,
    `Vivo en Heredia ya${ch(0x200b)}pague. ¿Me pasás el número?`,
    `Vivo en Heredia ${ch(0x443, 0x430)} ${ch(0x440, 0x430)}gue. ¿Me pasás el número?`,
    'Vivo en Heredia mi esposa mando. ¿A nombre de quién sale?',
    'Vivo en Heredia mi mama envio. ¿A nombre de quién sale?',
    'Vivo en Heredia mi hermano paso. ¿A nombre de quién sale?',
    'Vivo en Heredia paiement envoye. ¿Me pasás el número?',
  ]
  it('a claim hidden in the context sentence never gets the exemption', () => {
    for (const t of CLAIMS) {
      assert.equal(isClosedPayInfoQuestion(t), false, JSON.stringify(t))
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', JSON.stringify(t))
      assert.equal(paymentCheckGate(t, []), true, JSON.stringify(t))
    }
  })
  it('real places still pass; the "¿ya pagó?" check and the receipt cue never skip a free context sentence', () => {
    for (const t of ['Vivo en Heredia centro, ¿puedo pagar contra entrega?', 'Vivo en San José. ¿Puedo pagar contra entrega?', 'Vivo en Santa Ana de Escazú. ¿Puedo pagar contra entrega?']) {
      assert.equal(isClosedPayInfoQuestion(t), true, t)
      assert.equal(isClosedPayInfoQuestion(t, { strict: true }), false, t)
    }
    assert.equal(isClosedPayInfoQuestion('Lo quiero talla XL. ¿Puedo hacer el pago mañana y envío el comprobante?', { strict: true }), true)
    assert.equal(isClosedPayInfoQuestion('¿Qué le pongo de detalle?', { strict: true }), true)
  })
  it('an offer to send the card number gets the code card reply, also with the method question pending', () => {
    const CARD_FACTS = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta'], sinpe: { number: '88880000', holderName: 'Ana Mora' }, cardUrl: 'https://tienda.example/pagar' } })
    for (const t of ['Hola! quiero pagar ya, te paso el número de mi tarjeta por acá?', 'Le paso el numero de mi tarjeta por whatsapp', 'Lo quiero talla M. Te paso los datos de mi tarjeta?']) {
      assert.equal(classifyPaymentText(t), 'payment_info_safe', t)
      for (const awaitingPaymentMethod of [false, true]) {
        const d = decideInbound({ inboundText: t, brandFacts: CARD_FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod })
        assert.equal(d.handoff, null, t)
        assert.equal(d.shortcutKey, 'sys_payment_info', t)
        assert.match(String((d as { text?: string }).text ?? ''), /no mandés los datos de tu tarjeta por chat/, t)
        assert.match(String((d as { text?: string }).text ?? ''), /\[\[PAGO_TARJETA\]\]|tienda\.example\/pagar/, t)
      }
    }
    // No card block: a person sends how to pay (review), never the model.
    const noCard = decideInbound({ inboundText: 'te paso el número de mi tarjeta por acá?', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
    assert.equal(noCard.handoff?.kind, 'review')
  })
  it('a reply asking for card data is held in every form; a warning is not', () => {
    for (const t of [
      '¡Claro! Pasame el número de la tarjeta, la fecha de vencimiento y el código de atrás por aquí 😊',
      '¡Claro! ¿Me podés pasar el número de tu tarjeta?',
      'Con gusto, me puede enviar el número de su tarjeta y la fecha de vencimiento',
      'Envíeme el número de su tarjeta por favor',
      'Claro, páseme los datos de su tarjeta',
      'Me pasás los 16 dígitos de la tarjeta y el vencimiento?',
      'Perfecto, escribí acá el número de la tarjeta',
      'Mandá foto de la tarjeta por los dos lados',
      'El número de la tarjeta me lo pasás por acá',
      'Podés enviarme el número de la tarjeta y los 3 números de atrás',
      '¿Me compartís el número de la tarjeta?',
      'Pasame el CVV y listo',
    ]) assert.ok(validateAgentOutput({ text: t, citedToolNames: [] }).reasons.includes('card_data_request'), t)
    for (const t of ['Con tarjeta pagás en la web, nunca mandés los datos de la tarjeta por chat 😊', 'Por seguridad no me pases el número de tu tarjeta por acá: pagás en el link 😊', 'Aceptamos tarjeta en la web 🙌']) {
      assert.ok(!validateAgentOutput({ text: t, citedToolNames: [] }).reasons.includes('card_data_request'), t)
    }
    assert.match(read('src/lib/soft-ai/llm/prompt.ts'), /Nunca pidas ni aceptes datos de tarjeta por chat/)
  })
})

describe('SecureDog r3 Lows', () => {
  const ch = (...codes: number[]) => String.fromCharCode(...codes)
  it('the strict form never skips a sentence that opens with a yes', () => {
    for (const t of ['Sí, gracias. ¿A nombre de quién sale?', 'Sí, a nombre de quién sale?', 'Claro, me pasás el número?']) {
      assert.equal(isClosedPayInfoQuestion(t, { strict: true }), false, t)
      assert.equal(paymentCheckGate(t, [{ direction: 'outbound', content: '¿Pudiste hacer el SINPE?' }]), true, t)
    }
  })
  it('an ALL-CAPS "VIVO EN" with a pronoun / filler is not a place', () => {
    for (const t of ['VIVO EN HEREDIA JUAN LO MANDO. ¿TIENEN CONTRA ENTREGA?', 'VIVO EN HEREDIA TODO BIEN. ¿TIENEN CONTRA ENTREGA?']) {
      assert.equal(isClosedPayInfoQuestion(t), false, t)
    }
    assert.equal(isClosedPayInfoQuestion('VIVO EN HEREDIA. ¿TIENEN CONTRA ENTREGA?'), true)
  })
  it('an emoji with its own variation selector keeps the closed shape; after a letter it does not', () => {
    assert.equal(isClosedPayInfoQuestion(`¿Qué le pongo de detalle? ${ch(0x2764, 0xfe0f)}`), true)
    assert.equal(isClosedPayInfoQuestion(`¿Qué le pongo de detalle? ${ch(0x263a, 0xfe0f)}`), true)
    assert.equal(isClosedPayInfoQuestion(`Vivo en Heredia Ya${ch(0xfe0f)}Pagué. ¿Me pasás el número?`), false)
  })
  it('the outage path reads the whole unanswered burst for payment in play', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.ok(turn.includes('...outagePaymentState(unansweredPaymentState(burst.inboundText, history)),'))
    const hist = [{ direction: 'inbound', content: 'Mi tarjeta no pasa' }]
    assert.deepEqual(unansweredPaymentState('¿Qué hago?', hist), { inPlay: true, claim: true })
    assert.equal(unansweredPaymentState('¿Lo tienen en negro?', [{ direction: 'outbound', content: '¿Cómo preferís pagar?' }]).inPlay, false)
  })
})

/**
 * Rafael 2026-10-24 (all agents): a question about paying BEFORE buying ("¿pago envío?", "si llevo 3, ¿pago envío?",
 * "¿cuánto pago de envío?") is answered by the agent with the total / the methods. Only a real payment goes to a person,
 * and the agent never says a payment is confirmed.
 */
const PAY_SHIP_ASKS = [
  '¿Pago envío?',
  'Si llevo 3, ¿pago envío?',
  'si llevo 2 pago envio?',
  'Llevo 2, ¿pago envío?',
  'Y si llevo 2 pago el envío?',
  'Y si compro 3 kits, ¿pago envío?',
  '¿Cuánto pago de envío?',
  '¿Cuánto pago en total?',
  'cuanto seria en total con envio',
  'Si pido 3 kits cuánto sería en total con envío',
  '¿El envío lo pago yo?',
  '¿El envío lo pago aparte?',
  '¿quién paga el envío?',
  'Hola, ¿pago envío?',
  // Verifier r1 #3
  '¿el envio lo pago yo?',
  'el envio lo pago aparte?',
  '¿Pago envío si llevo 3?',
  '¿Cuánto pago de envío a Heredia?',
  '¿Cuánto pago con envío?',
  '¿Y el envío lo pago yo?',
  '¿Cuánto pagaría de envío?',
]
const PAY_SHIP_PERSON = [
  'Ya pagué, ¿cuánto pago de envío?',
  '¿Pago envío? Le hice el sinpe',
  'Si llevo 3 ya pagué, ¿pago envío?',
  'llevo 3 ya pague, ¿pago envío?',
  'Si llevo 3 le hice el sinpe, ¿pago envío?',
  'quiero 2, ya les pague el envio?',
  '¿Les llegó? ¿Cuánto pago de envío?',
  'Pago el envío ✅',
  '¿Pago envío? ✅',
  '¿Pago envío? ya te lo mande',
  'El envío lo pago mi esposo?',
  'El envío lo pago Juan?',
  'Mi esposo pago el envío',
  '¿Pago la mitad del envío?',
  '¿Cuánto pago del resto?',
  '¿Cuánto me falta por pagar?',
  'Si llevo 20.000, ¿pago envío?',
  'Si llevo 3000 ¿pago envío?',
  'Pago envío',
  'pago el envio',
  '¿Pago la mitad hoy si mi cuñado cancelo la otra?',
  '¿Pago env\u200Bío? ya pague',
  '¿Раgo envío? ya pague',
  // Verifier r1 #1: a yes / ok in front can answer the store's "¿Pudiste hacer el SINPE?"
  'Sí, cuánto pago de envío?',
  'Si, pago envio?',
  'Claro, cuánto pago en total?',
  'Sí, el envío lo pago aparte?',
  'si, cuanto pago en total',
  'Sí cuanto pago de envio',
  'Listo, ¿cuánto pago de envío?',
  // Verifier r1 #2: how much is LEFT is a part payment
  '¿Cuánto pago del total?',
  // Verifier r1 #5 / places
  'Pago el envio. Pago el envio?',
  '¿Cuánto pago de envío a mi esposo ya le pague?',
  '¿Cuánto pago de envío a la cuenta que les transferí?',
]

describe('pre-purchase payment questions (Rafael 2026-10-24)', () => {
  it('are answered by the agent, also in the strict form (no "¿ya pagó?" model check)', () => {
    for (const t of PAY_SHIP_ASKS) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
      assert.equal(isClosedPayInfoQuestion(t), true, t)
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.notEqual(d.paymentClass, 'payment_proof_or_risk', t)
      assert.equal(d.handoff, null, t)
    }
    // A leading "si" reads as a yes in the strict form (SecureDog r3), and a free place is never strict (SecureDog r1
    // 2026-10-24): the "¿ya pagó?" check still looks at those.
    for (const t of PAY_SHIP_ASKS.filter((x) => !/^(hola|s[ií])\b/i.test(x) && !/env[ií]o a /i.test(x))) assert.equal(isClosedPayInfoQuestion(t, { strict: true }), true, t)
  })

  it('a claim, a third payer, a part payment, an amount or a statement keeps the person path', () => {
    for (const t of PAY_SHIP_PERSON) assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    // No payment word (same as before 2026-10-24), but never the closed shape: the "¿ya pagó?" check still reads them.
    for (const t of ['¿Cuánto queda del total?', '¿Cuánto queda en total?']) {
      assert.equal(isClosedPayInfoQuestion(t), false, t)
      assert.equal(isClosedPayInfoQuestion(t, { strict: true }), false, t)
    }
  })

  it('the legacy worker keeps plain price questions non-sensitive (Verifier r1 #4)', () => {
    for (const t of ['¿Cuánto sale el envío?', '¿Cuánto es el total?', '¿Quién paga el envío?', 'Cuánto sería en total con envío']) assert.equal(isPaymentSensitiveText(t), false, t)
    for (const t of ['¿Pago envío?', 'Que le pongo de detalle']) assert.equal(isPaymentSensitiveText(t), true, t)
  })

  it('the reply still never confirms a payment on these turns', () => {
    for (const t of ['¿Pago envío?', 'Si llevo 3, ¿pago envío?']) {
      for (const reply of ['¡Pago confirmado! El envío es ₡3 000', 'Recibimos tu pago 🙌']) {
        const r = validateAgentOutput({ text: reply, customerText: t, paymentContext: true } as Parameters<typeof validateAgentOutput>[0])
        assert.equal(r.ok, false, reply)
        assert.ok(r.reasons.some((x) => x === 'payment_status_claim' || x === 'confirmation_wording'), JSON.stringify(r))
      }
      const fine = validateAgentOutput({ text: 'Depende de cuántos kits llevés 😊 ¿Cuántos querés?', customerText: t, paymentContext: true } as Parameters<typeof validateAgentOutput>[0])
      assert.equal(fine.ok, true, JSON.stringify(fine))
    }
  })
})

describe('pre-purchase payment questions · SecureDog r1 (2026-10-24)', () => {
  it('a free place after "envío a" is a capitalised place with no money / done word, and never skips the "¿ya pagó?" check', () => {
    assert.equal(isClosedPayInfoQuestion('¿Cuánto pago de envío a Heredia?'), true)
    assert.equal(isClosedPayInfoQuestion('¿Cuánto pago de envío a San José?'), true)
    for (const t of ['¿Cuánto pago de envío a Heredia?', '¿Cuánto pago de envío a San José?']) assert.equal(isClosedPayInfoQuestion(t, { strict: true }), false, t)
    for (const t of ['¿Cuánto pago de envío a Heredia Recibido?', '¿Cuánto pago de envío a Heredia Puse Plata?', '¿Cuánto pago de envío a Heredia Mandé?', '¿Cuánto pago de envío a Heredia Sinpe?']) {
      assert.equal(isClosedPayInfoQuestion(t), false, t)
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })

  it('in the strict form a yes / ok in front of any sentence keeps the "¿ya pagó?" check (old shapes too)', () => {
    for (const t of ['Hola sí, el envío lo pago aparte?', 'Hola, sí, pago envío?', 'Upe dale, pago envío?', 'Hola ¿sí, el envío lo pago aparte?', 'Buenas ¿claro, cuánto pago en total?', 'Hola ¿ok, el envío lo pago yo?', 'Gracias ¿sí, a nombre de quién sale?']) {
      assert.equal(isClosedPayInfoQuestion(t, { strict: true, yesBlocksAll: true }), false, t)
    }
    for (const t of ['Hola sí, el envío lo pago aparte?', 'Hola, sí, pago envío?', 'Upe dale, pago envío?', 'Hola ¿ok, el envío lo pago yo?']) assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })

  it('a money trace in an earlier unanswered bubble sends the price question to a person; an order burst does not', () => {
    for (const earlier of [['La mitad'], ['₡15 000'], ['15 mil'], ['✅'], ['Ya les hice el sinpe'], ['Les debo el resto'], ['15 lucas']]) {
      const d = decideInbound({ inboundText: '¿Pago envío?', earlierCustomerTexts: earlier, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.paymentClass, 'payment_proof_or_risk', earlier[0])
    }
    for (const earlier of [['Hola'], ['Quiero 3 kits'], ['Buenas tardes', 'Me interesa el avión']]) {
      const d = decideInbound({ inboundText: '¿Pago envío?', earlierCustomerTexts: earlier, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.notEqual(d.paymentClass, 'payment_proof_or_risk', earlier.join(' | '))
    }
  })

  it('a "Vivo en …" context never carries money / done words', () => {
    for (const t of ['Vivo en Heredia Puse Plata. ¿Cómo pago?', 'Vivo en Heredia Recibieron. ¿Pago envío?', 'Vivo en Cartago Mande. ¿Cómo pago?']) assert.equal(isClosedPayInfoQuestion(t), false, t)
  })

  it('implicit "your payment arrived" statements are held (L2, narrowed in r2 F2)', () => {
    for (const reply of ['Con lo que ya pagaste, solo te queda el envío', 'Lo que ya nos transferiste cubre el kit']) {
      const r = validateAgentOutput({ text: reply, customerText: '¿Pago envío?', paymentContext: true, modelText: true } as unknown as Parameters<typeof validateAgentOutput>[0])
      assert.ok(r.reasons.includes('payment_status_claim'), `${reply} → ${JSON.stringify(r.reasons)}`)
    }
  })
})

describe('pre-purchase payment questions · SecureDog r2 (2026-10-24)', () => {
  const route = (earlier: string[], latest: string) =>
    decideInbound({ inboundText: latest, earlierCustomerTexts: earlier, unansweredCustomerTexts: earlier, brandFacts: FACTS, shortcuts: SHORTCUTS }).paymentClass

  it('F1: an ordinary order chat keeps the live path on a plain price question', () => {
    const chats: Array<[string[], string]> = [
      [['2'], '¿Cuánto sale el envío?'],
      [['Mi número es 8888-8888'], '¿Cuánto sale el envío?'],
      [['Talla 38'], '¿Cuánto sale el envío?'],
      [['¿Ya tienen el kit rojo?'], '¿Cuánto sale el envío?'],
      [['Me gusta 👍'], '¿Cuánto sale el envío?'],
      [['El combo de 3'], '¿Quién paga el envío?'],
      [['Ya vi los precios'], 'Cuánto sería en total con envío'],
      [['2'], '¿Pago envío?'],
      [['Hola', 'Quiero 3 kits'], '¿Pago envío?'],
    ]
    for (const [earlier, latest] of chats) assert.notEqual(route(earlier, latest), 'payment_proof_or_risk', `${earlier.join(' | ')} → ${latest}`)
  })

  it('R2: money after the question also sends it to a person', () => {
    const chats: Array<[string[], string]> = [
      [['¿Pago envío?'], '₡15 000'],
      [['¿Cuánto pago de envío?'], 'La mitad'],
      [['¿Pago envío?'], '15 mil'],
      [['¿Pago envío?'], '✅'],
      [['¿Pago envío?'], 'Les debo el resto'],
    ]
    for (const [earlier, latest] of chats) assert.equal(route(earlier, latest), 'payment_proof_or_risk', `${earlier.join(' | ')} → ${latest}`)
  })

  it('R1: a yes / ok as its own sentence keeps the person path (and the strict "¿ya pagó?" check)', () => {
    for (const t of ['Hola, ok. ¿Pago envío?', 'Hola, perfecto. ¿Pago envío?', 'Genial. ¿Pago envío?', 'Excelente, ¿cuánto pago en total?', 'Hola, dale, ¿el envío lo pago aparte?', 'Pura vida. ¿Pago envío?', 'Ok, ¿cuánto pago de envío?', 'Hola sí llevo 2, pago envío?']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
      assert.equal(isClosedPayInfoQuestion(t, { strict: true }), false, t)
    }
    assert.equal(isClosedPayInfoQuestion('Hola, ok. ¿A nombre de quién sale?', { strict: true, yesBlocksAll: true }), false)
  })

  it('R3 / F3: status verbs never in a place; "plata" as a colour is fine', () => {
    for (const t of ['¿Cuánto pago de envío a San José Centro Llegó?', '¿Cuánto pago de envío a Heredia Juan Realizó?']) assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    assert.notEqual(classifyPaymentText('Lo quiero color plata. ¿Cómo pago?'), 'payment_proof_or_risk')
    assert.equal(isClosedPayInfoQuestion('Vivo en Heredia Puse Plata. ¿Cómo pago?'), false)
  })

  it('F2: deposit policy, questions and conditionals are ordinary replies; an unconditional past payment is held', () => {
    const v = (text: string) =>
      validateAgentOutput({ text, customerText: '¿Cuánto pago en total?', paymentContext: true, modelText: true } as unknown as Parameters<typeof validateAgentOutput>[0]).reasons
    for (const r of ['Para apartarlo pagás la mitad y la otra mitad al recibir', 'Con el adelanto te lo reservamos por 3 días', 'Si ya pagaste, mandame el comprobante por aquí', '¿Ya pagaste o querés que te pase los datos?', 'Tu pedido queda apartado cuando recibamos el comprobante']) {
      assert.ok(!v(r).includes('payment_status_claim'), `${r} → ${JSON.stringify(v(r))}`)
    }
    for (const r of ['Con lo que ya pagaste, solo te queda el envío', 'Ya nos depositaste, gracias']) assert.ok(v(r).includes('payment_status_claim'), r)
  })
})

describe('pre-purchase payment questions · Verifier r2 (2026-10-24)', () => {
  // The earlier bubbles were answered by the store (in the 10-minute window, not unanswered) unless said otherwise.
  const route = (earlier: string[], latest: string, unanswered: string[] = []) =>
    decideInbound({ inboundText: latest, earlierCustomerTexts: earlier, unansweredCustomerTexts: unanswered, brandFacts: FACTS, shortcuts: SHORTCUTS }).paymentClass

  it('#1: questions live already answered keep the live path, whatever else is in the chat', () => {
    const chats: Array<[string[], string]> = [
      [['Hola, precio?', '₡17 900? ok'], '¿Hay que pagar envío?'],
      [['Me interesa el de 15 mil'], '¿Hay que pagar envío?'],
      [['Ana Mora\n8888-1234\nHeredia, San Pablo\nCódigo postal 40101'], '¿Hay que pagar envío?'],
      [['¿Hay que pagar envío?'], 'Mil gracias'],
      [['¿Tengo que pagar el envío aparte?'], 'Perfecto, a Cartago 30101'],
      [['Quiero 2 rojos'], '¿Hay que pagar el envío también?'],
    ]
    for (const [earlier, latest] of chats) assert.notEqual(route(earlier, latest), 'payment_proof_or_risk', `${earlier.join(' | ')} → ${latest}`)
  })

  it('#4: order data and a price asked back do not block a rescued "¿pago envío?"', () => {
    const chats: Array<[string[], string]> = [
      [['Mil gracias'], '¿Pago envío?'],
      [['Ana Mora\n8888-1234\nCódigo postal 40101'], '¿Cuánto pago de envío?'],
      [['ana1990@gmail.com'], '¿Pago envío?'],
      [['Casa 1520'], '¿Pago envío?'],
      [['₡17 900?'], '¿Pago envío?'],
      [['Pedido #10234'], '¿Pago envío?'],
    ]
    for (const [earlier, latest] of chats) assert.notEqual(route(earlier, latest), 'payment_proof_or_risk', `${earlier.join(' | ')} → ${latest}`)
  })

  it('#5: a bare yes / done bubble next to a rescued "¿pago envío?" goes to a person (as on live)', () => {
    for (const yes of ['Sí', 'Listo', 'Ya quedó', 'Ahí va', 'Sí señora', 'Ok', 'Dale', 'Perfecto', '👍', 'Gracias', 'Ahí les va']) assert.equal(route([yes], '¿Pago envío?', [yes]), 'payment_proof_or_risk', yes)
  })

  it('#2: the receipt cue keeps the old strict meaning; only the "¿ya pagó?" gate blocks on any yes', () => {
    for (const t of ['Pura vida, ¿puedo pagar mañana y mando el comprobante?', 'Genial, ¿puedo hacer el pago mañana y envío el comprobante?']) {
      assert.equal(isClosedPayInfoQuestion(t, { strict: true }), isClosedPayInfoQuestion(t, { strict: true, payShip: false }), t)
    }
    assert.equal(isClosedPayInfoQuestion('Gracias ¿sí, a nombre de quién sale?', { strict: true, yesBlocksAll: true }), false)
  })

  it('#3: "mandaste" (data, photos) is an ordinary reply', () => {
    const v = (text: string) =>
      validateAgentOutput({ text, customerText: '¿Pago envío?', paymentContext: true, modelText: true } as unknown as Parameters<typeof validateAgentOutput>[0]).reasons
    for (const r of ['¡Perfecto! Con lo que ya me mandaste tengo todo para el envío 😊', 'Lo que ya nos mandaste está perfecto 😊']) assert.ok(!v(r).includes('payment_status_claim'), r)
  })

  it('#6 / #7: legacy worker unchanged for plain questions; a quantity never rides with an older shape; "Quedó" is not a place', () => {
    assert.equal(isPaymentSensitiveText('¿Hay que pagar envío?'), false)
    assert.equal(isClosedPayInfoQuestion('Quiero 2. ¿A nombre de quién sale?'), false)
    assert.equal(classifyPaymentText('¿Cuánto pago de envío a Heredia Quedó?'), 'payment_proof_or_risk')
  })
})

describe('pre-purchase payment questions · Verifier r3 allow-list (2026-10-24)', () => {
  const route = (unanswered: string[], latest: string) =>
    decideInbound({ inboundText: latest, earlierCustomerTexts: unanswered, unansweredCustomerTexts: unanswered, brandFacts: FACTS, shortcuts: SHORTCUTS }).paymentClass
  it('a rescued question next to greetings, a quantity or a plain order line is answered', () => {
    for (const u of [[], ['Hola'], ['Buenas tardes'], ['2'], ['3 kits'], ['Quiero 3 kits'], ['Me interesa el avión'], ['Hola', 'Quiero 2']]) assert.notEqual(route(u, '¿Pago envío?'), 'payment_proof_or_risk', u.join(' | '))
  })
  it('anything else next to it keeps the person path (as live), before or after', () => {
    for (const u of [['₡150000'], ['15000'], ['Ok 17900'], ['quince mil'], ['diez mil colones'], ['15 rojos'], ['₡15 000 ya?'], ['¿Ya vieron? ₡15 000'], ['Sí claro'], ['Sip'], ['Simón'], ['Ahí te va'], ['Ana Mora 8888-1234 Heredia'], ['Ya hice el sinpe']]) {
      assert.equal(route(u, '¿Pago envío?'), 'payment_proof_or_risk', u.join(' | '))
    }
    for (const latest of ['₡150000', 'Sí señora', 'La mitad']) assert.equal(route(['¿Pago envío?'], latest), 'payment_proof_or_risk', latest)
  })
  it('a reply to the agent after its answer is not swept back in (answered bubbles are not unanswered)', () => {
    for (const latest of ['Sí', 'Ya', 'Listo']) {
      const d = decideInbound({ inboundText: latest, earlierCustomerTexts: ['¿Pago envío?'], unansweredCustomerTexts: [], brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.why ?? null, null, latest)
    }
  })
  it('"gracias" in front or in a place keeps the person path; a question after a statement does not hide it', () => {
    assert.equal(classifyPaymentText('Gracias ¿pago envío?'), 'payment_proof_or_risk')
    assert.equal(classifyPaymentText('¿Cuánto pago de envío a Heredia Gracias?'), 'payment_proof_or_risk')
    const v = (text: string) =>
      validateAgentOutput({ text, customerText: '¿Pago envío?', paymentContext: true, modelText: true } as unknown as Parameters<typeof validateAgentOutput>[0]).reasons
    assert.ok(v('Con lo que ya pagaste, ¿te lo envío hoy?').includes('payment_status_claim'))
    assert.ok(!v('Si ya pagaste, mandame el comprobante por aquí').includes('payment_status_claim'))
  })
})

describe('pre-purchase payment questions · Verifier r4 (2026-10-24)', () => {
  const route = (unanswered: string[], latest: string) =>
    decideInbound({ inboundText: latest, earlierCustomerTexts: unanswered, unansweredCustomerTexts: unanswered, brandFacts: FACTS, shortcuts: SHORTCUTS }).paymentClass
  it('#1: only bubbles after the store\'s last message (plus a 60 s race) are "unanswered"', async () => {
    const { customerTextsSinceStore } = await import('@/lib/soft-ai/payment-claim-check-core')
    const t0 = Date.parse('2026-10-24T20:00:00Z')
    const at = (s: number) => new Date(t0 + s * 1000).toISOString()
    const history = [
      { direction: 'inbound', content: '¿Pago envío?', sentAt: at(0) },
      { direction: 'inbound', content: 'Escrito mientras respondían', sentAt: at(170) },
      { direction: 'outbound', content: 'Con 2 kits va incluido: ₡29 800. ¿Te lo aparto?', sentAt: at(200) },
      { direction: 'inbound', content: 'Sí', sentAt: at(230) },
    ]
    assert.deepEqual(customerTextsSinceStore(history), { after: ['Sí'], race: ['Escrito mientras respondían'] })
    // Verifier r5: the agent answers within seconds — the answered question sits in the race list, never as "rescued".
    const fast = [
      { direction: 'inbound', content: '¿Pago envío?', sentAt: at(0) },
      { direction: 'outbound', content: 'Con 2 kits va incluido: ₡29 800. ¿Te lo aparto?', sentAt: at(5) },
      { direction: 'inbound', content: 'Sí', sentAt: at(30) },
    ]
    const parts = customerTextsSinceStore(fast)
    for (const latest of ['Sí', 'Dale', 'Mil gracias', 'Ana Mora, Heredia']) {
      const d = decideInbound({ inboundText: latest, earlierCustomerTexts: ['¿Pago envío?'], unansweredCustomerTexts: parts.after.filter((x) => x !== 'Sí'), raceCustomerTexts: parts.race, brandFacts: FACTS, shortcuts: SHORTCUTS })
      assert.equal(d.why ?? null, null, latest)
    }
    // A race bubble with money still counts as a neighbour of a NEW rescued question.
    const d2 = decideInbound({ inboundText: '¿Cuánto pago en total?', earlierCustomerTexts: ['₡15 000'], unansweredCustomerTexts: [], raceCustomerTexts: ['₡15 000'], brandFacts: FACTS, shortcuts: SHORTCUTS })
    assert.equal(d2.paymentClass, 'payment_proof_or_risk')
  })
  it('#2: money, refund and after-purchase lines are not a plain order line', () => {
    for (const u of ['Quiero mi plata de vuelta', 'Necesito mi dinero', 'Me interesa el kit de quince mil', 'Quiero el de veinte rojos', 'Llevo 3 días esperando el pedido', 'Llevo 2 semanas esperando', 'Busco mi pedido', 'Necesito la factura', 'Busco el número de guía', 'Quiero que verifiquen', 'Ocupo que me ayuden con mi pedido', 'Quiero el otro pedido igual que el anterior']) {
      assert.equal(route([u], '¿Pago envío?'), 'payment_proof_or_risk', u)
    }
    for (const u of ['Quiero 3 kits', 'Me interesa el avión', 'Quiero hacer un pedido']) assert.notEqual(route([u], '¿Pago envío?'), 'payment_proof_or_risk', u)
  })
})
