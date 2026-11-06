/**
 * Pura Sonrisa 2026-11-05 (live chat 23:48Z): data sent → total + "¿Cómo preferís pagar?", never the echoed data or
 * "Dame un momento y te confirmo"; a held echo is rescued by a code-written line; follow-ups nudge "data given, payment
 * not chosen" only for an arm with a pay_pending text.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSalesState, formatSalesTurnBlock, salesDataListFirst, salesMethodQuestion, type SalesContext } from '@/lib/soft-ai/sales-state'
import { dataEchoRescueText, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { followUpSlot, followUpStateSkip, parseStageTexts } from '@/lib/soft-ai/follow-up-state'
import { parseSalesRules } from '@/lib/soft-ai/agent-sales-setup'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

const CTX: SalesContext = {
  catalog: [
    { name: 'Pura Sonrisa Sandia', price: 10450, stockLabel: 'disponible' },
    { name: 'Pura Sonrisa Menta', price: 10450, stockLabel: 'disponible' },
  ],
  bundles: [{ name: 'Combo 2 cajas', price: 19900, shippingIncluded: true }],
  shippingMethods: [{ name: 'Envío a domicilio', price: 3000, coverage: 'todo el país', cod: 'GAM' }],
  orderFields: ['Nombre', 'Teléfono'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['62019914'],
  paymentMethods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'],
  promo: null,
  dataThenPay: true,
}

let n = 0
const msg = (direction: 'inbound' | 'outbound', content: string): SoftAiHistoryMessage => ({
  id: String((n += 1)),
  direction,
  content,
  sentAt: new Date(2026, 10, 5, 17, n).toISOString(),
})

const DATA_ASK =
  'Perfecto, envío a domicilio 😊 Pasame estos datos:\n- Nombre completo\n- Teléfono\n- Correo (opcional)\n- Provincia\n- Cantón\n- Distrito\n- Dirección exacta con señas'
const DATA = 'Adriana Rojas\n85841234\nHeredia\nUlloa\nLagunilla\nAvenida la Gardenia, frente al súper'

/** The live transcript up to the data (scrubbed / invented names and phone). */
const LAURA: SoftAiHistoryMessage[] = [
  msg('inbound', 'Hola buenas tardes'),
  msg('outbound', '¡Hola! Soy Laura de Pura Sonrisa CR 😁 ¿Qué te gustaría saber sobre nuestras tiras blanqueadoras?'),
  msg('inbound', 'Me intensa adquirir las tiras blanqueadoras'),
  msg('outbound', 'Una caja cuesta ₡10 450 más ₡3 000 de envío; el Combo 2 sale ₡19 900 en total, ya con el envío.'),
  msg('inbound', 'Me interesa una caja para probar primero el producto a ver qué tal'),
  msg('outbound', '¡Claro! Tenemos Menta, Sandía, Fresa y Blue Raspberry. ¿Cuál preferís?'),
  msg('inbound', 'Si de sandía'),
  msg('outbound', '¡Perfecto, Sandía 🍉! ¿Preferís envío a domicilio o retiro con cita?'),
  msg('inbound', 'Domicilio'),
  msg('outbound', DATA_ASK),
]

describe('data then pay: sales stage (Laura 2026-11-05)', () => {
  it('the live transcript: data sent → cierre + dataReceived, the step says total + method question, never echo', () => {
    const s = deriveSalesState({ history: LAURA, inboundText: DATA, ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.equal(s.dataReceived, true)
    assert.match(s.nextStep, /no los repitas/)
    assert.match(s.nextStep, /total/)
    assert.match(s.nextStep, /pregunta de pago/)
    const block = formatSalesTurnBlock(CTX, s)
    assert.ok(block.includes(salesMethodQuestion(CTX)), 'the code-built method question is in the turn block')
    assert.equal(salesDataListFirst(s, LAURA, DATA, CTX), null, 'the data list is never asked again')
  })

  it('data in separate bubbles (name / phone / address) counts once joined', () => {
    const history = [...LAURA, msg('inbound', 'Adriana Rojas'), msg('inbound', '85841234')]
    const s = deriveSalesState({ history, inboundText: 'Heredia, Ulloa, Lagunilla, frente al súper', ctx: CTX })
    assert.equal(s.dataReceived, true)
    assert.equal(s.stage, 'cierre')
  })

  it('agents not set to pay after data keep the old stage (no change for Sofi / Vale / Dani / Andrés)', () => {
    const s = deriveSalesState({ history: LAURA, inboundText: DATA, ctx: { ...CTX, dataThenPay: false } })
    assert.equal(s.dataReceived, undefined)
    assert.equal(s.stage, 'cotizar')
  })

  it('method question already pending → metodo_pago stays (never asked twice)', () => {
    const history = [...LAURA, msg('outbound', '¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia y tarjeta.')]
    const s = deriveSalesState({ history, inboundText: DATA, ctx: CTX })
    assert.equal(s.stage, 'metodo_pago')
    assert.equal(s.dataReceived, undefined)
  })

  it('a phone + question with no data request and no want cue is not order data', () => {
    const history = [msg('inbound', 'Hola'), msg('outbound', '¡Hola! ¿Qué te gustaría saber?')]
    const s = deriveSalesState({ history, inboundText: 'Hola soy Ana, 8888-1234, San José centro, ¿precio?', ctx: CTX })
    assert.equal(s.dataReceived, undefined)
  })

  it('payment details already sent → esperando_comprobante, not the data step', () => {
    const history = [...LAURA, msg('inbound', DATA), msg('outbound', 'SINPE Móvil: 6201 9914 a nombre de Rafael García. Mandame el comprobante 😊')]
    const s = deriveSalesState({ history, inboundText: 'ok', ctx: CTX })
    assert.equal(s.stage, 'esperando_comprobante')
    assert.equal(s.dataReceived, undefined)
  })

  it('afterData is kept by parseSalesRules only as "pay"', () => {
    assert.equal(parseSalesRules({ afterData: 'pay' }).afterData, 'pay')
    assert.equal(parseSalesRules({ afterData: 'review' }).afterData, undefined)
    assert.equal(parseSalesRules({}).afterData, undefined)
  })
})

const ECHO = '- Nombre completo: Adriana Rojas\n- Teléfono: 85841234\n- Provincia: Heredia\n\n¿Cómo preferís pagar?\n- SINPE\n- Transferencia'
const BASE = {
  dataReceived: true,
  methodQuestion: salesMethodQuestion(CTX),
  reasons: ['payment_number_unsourced'],
  modelAskedHuman: false,
  toolProblem: false,
  escalate: false,
  llmHandoff: { kind: 'review' as const, reason: 'review' },
  text: ECHO,
  customerText: DATA,
}

describe('data then pay: echo rescue (never "Dame un momento" for an echo)', () => {
  it('echo of the customer\'s own phone only → thanks + the method question, no hand-off', () => {
    const line = dataEchoRescueText(BASE)
    assert.ok(line && line.startsWith('¡Gracias por tus datos!'))
    assert.ok(line.includes(salesMethodQuestion(CTX)))
    assert.doesNotMatch(line, /\d{4}/, 'no customer number in the rescue line')
    const plan = planModelTurnDelivery({ text: ECHO, textOk: false, llmHandoff: BASE.llmHandoff, customerText: DATA, dataEchoRescue: line })
    assert.deepEqual(plan, { text: line, handoff: null })
  })

  it('never fires: invented number, another reason, model asked a person, unknown fields, not shareable, card by team, receipt', () => {
    const cases: Array<Record<string, unknown>> = [
      { text: `${ECHO}\nSINPE al 70001111` },
      { reasons: ['payment_number_unsourced', 'amount_unsourced'] },
      { reasons: [] },
      { modelAskedHuman: true },
      { modelAskedHuman: undefined },
      { toolProblem: undefined },
      { escalate: true },
      { llmHandoff: { kind: 'handoff', reason: 'complaint' } as never },
      { methodQuestion: null },
      { dataReceived: false },
      { cardByTeam: true },
      { paymentDataByTeam: true },
      { receiptCue: true },
    ]
    for (const c of cases) assert.equal(dataEchoRescueText({ ...BASE, ...c } as never), null, JSON.stringify(c))
  })

  it('without a rescue the review safe line still goes out (unchanged behaviour)', () => {
    const plan = planModelTurnDelivery({ text: ECHO, textOk: false, llmHandoff: BASE.llmHandoff, customerText: DATA, dataEchoRescue: null })
    assert.equal(plan.text, SAFE_LINE.review)
    assert.equal(plan.handoff?.kind, 'review')
  })

  it('a true hand-off is never overruled by the rescue', () => {
    const plan = planModelTurnDelivery({ text: ECHO, textOk: false, llmHandoff: { kind: 'handoff', reason: 'complaint' }, customerText: DATA, dataEchoRescue: 'x' })
    assert.equal(plan.handoff?.kind, 'handoff')
  })
})

const fin = (content: string) => ({ direction: 'inbound', content })
const fout = (content: string) => ({ direction: 'outbound', content })

describe('data then pay: follow-up slot pay_pending', () => {
  const chat = [
    fin('Si de sandía'),
    fout(DATA_ASK),
    fin(DATA),
    fout('¡Gracias! 🙌 El total es ₡13 450 con envío.'),
    fout('¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta y contra entrega (solo GAM).'),
  ]

  it('data given + our method question last + customer quiet → pay_pending (still data_given for the skip rule)', () => {
    assert.equal(followUpSlot(chat, false, PP), 'pay_pending')
    assert.equal(followUpStateSkip(chat, false), 'data_given')
  })

  it('not pay_pending: no method question, customer answered, a later date, or payment details sent', () => {
    assert.notEqual(followUpSlot(chat.slice(0, 4), false, PP), 'pay_pending')
    assert.notEqual(followUpSlot([...chat, fin('SINPE')], false, PP), 'pay_pending')
    const later = [fin('Si de sandía'), fout(DATA_ASK), fin(`${DATA}\nmañana le escribo`), chat[4]]
    assert.notEqual(followUpSlot(later, false, PP), 'pay_pending')
    assert.equal(followUpSlot([...chat, fout('SINPE Móvil: 6201 9914 a nombre de Rafael García')], false, PP), 'sinpe_reminder')
  })

  it('pay_pending texts follow the reminder ban (no digits, money words or links)', () => {
    assert.deepEqual(parseStageTexts({ pay_pending: '¡Hola! 😁 Ya tengo tus datos. ¿Cómo preferís pagar?' }), { pay_pending: '¡Hola! 😁 Ya tengo tus datos. ¿Cómo preferís pagar?' })
    assert.equal(parseStageTexts({ pay_pending: 'Son ₡13 450, ¿me pagás?' }), undefined)
    assert.equal(parseStageTexts({ pay_pending: 'Pagá en purasonrisa.shopping' }), undefined)
  })
})

const PP = { payPending: true }

describe('data then pay: verifier r1 + SecureDog r1', () => {
  it('#1 one-line data and the pickup pair (name + phone) after the list count', () => {
    for (const t of ['Adrian Retana 85844314 Heredia Ulloa Lagunilla Avenida la Gardenia', 'Adrian Retana\n85844314']) {
      const s = deriveSalesState({ history: LAURA, inboundText: t, ctx: CTX })
      assert.equal(s.dataReceived, true, t)
    }
  })

  it('#4 no data request yet → never the data step (even with "quiero"); a retraction after the data is not a close', () => {
    const early = [msg('inbound', 'Hola'), msg('outbound', '¡Hola! ¿Qué te gustaría saber?')]
    const s1 = deriveSalesState({ history: early, inboundText: 'Quiero saber si llega a Heredia, barrio Los Ángeles, mi número es 8888-1234', ctx: CTX })
    assert.equal(s1.dataReceived, undefined)
    const s2 = deriveSalesState({ history: LAURA, inboundText: `${DATA}\nmejor no, después le escribo`, ctx: CTX })
    assert.equal(s2.dataReceived, undefined)
  })

  it('#2 sold-out focus → no dataReceived (no rescue, no method question)', () => {
    const ctx = { ...CTX, stock: { soldOut: [{ name: 'Pura Sonrisa Sandia', back: null }], inStockNames: ['Pura Sonrisa Menta'] } } as unknown as SalesContext
    const s = deriveSalesState({ history: LAURA, inboundText: `${DATA}\nla de Sandia`, ctx })
    assert.ok(s.soldOutFocus, 'the sold-out flavor is in focus')
    assert.equal(s.dataReceived, undefined)
  })

  it('#5 an after-data agent at the close before the data: no payment question line, the step asks total + data', () => {
    const history = [msg('inbound', 'Hola'), msg('outbound', 'Una caja cuesta ₡10 450 más ₡3 000 de envío.')]
    const s = deriveSalesState({ history, inboundText: 'Lo quiero, sandía con envío', ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.match(s.nextStep, /Todavía NO preguntes cómo pagar/)
    assert.ok(!formatSalesTurnBlock(CTX, s).includes('Pregunta de pago'))
    const other = deriveSalesState({ history, inboundText: 'Lo quiero, sandía con envío', ctx: { ...CTX, dataThenPay: false } })
    assert.ok(formatSalesTurnBlock({ ...CTX, dataThenPay: false }, other).includes('Pregunta de pago'), 'other agents unchanged')
  })

  it('#7 shape-only reasons do not stop the rescue; INT-251 separated or spanning numbers do', () => {
    assert.ok(dataEchoRescueText({ ...BASE, reasons: ['payment_number_unsourced', 'style_too_long', 'shortened'] }))
    for (const extra of ['SINPE al 7000–1111', 'SINPE al 7000 / 1111', 'SINPE al 7000_1111', 'SINPE al 7000·1111', 'SINPE al 7000  1111']) {
      assert.equal(dataEchoRescueText({ ...BASE, text: `${ECHO}\n${extra}` }), null, extra)
    }
    assert.equal(dataEchoRescueText({ ...BASE, customerText: 'Tel 8888 1234, cédula 1 2345 6789', text: 'Tel 12341234 ¿Cómo preferís pagar?' }), null)
    assert.ok(dataEchoRescueText({ ...BASE, text: '+506 8584-1234 ¿cómo preferís pagar?' }), '+506 / dashes of her own number still rescue')
  })

  it('INT-250: a photo or payment-like bubble next to the data → no pay_pending nudge; #11 no text → old slot', () => {
    const withPhoto = [fin('Si de sandía'), fout(DATA_ASK), { direction: 'inbound', content: '[image]', messageType: 'image' }, fin(DATA), fout('¿Cómo preferís pagar? Tenemos SINPE Móvil y transferencia.')]
    assert.notEqual(followUpSlot(withPhoto, false, PP), 'pay_pending')
    const paid = [fin('Si de sandía'), fout(DATA_ASK), fin(`${DATA}\nya le hice el sinpe`), fout('¿Cómo preferís pagar? Tenemos SINPE Móvil y transferencia.')]
    assert.notEqual(followUpSlot(paid, false, PP), 'pay_pending')
    const ok = [fin('Si de sandía'), fout(DATA_ASK), fin(DATA), fout('¿Cómo preferís pagar? Tenemos SINPE Móvil y transferencia.')]
    assert.equal(followUpSlot(ok, false, PP), 'pay_pending')
    assert.notEqual(followUpSlot(ok, false), 'pay_pending', 'an arm without the text never gets the slot')
  })
})

describe('data then pay: verifier r2', () => {
  it('N1: data → "Dame un momento" → "¿Cómo te pago?" still gets the total + method question (never the list again)', () => {
    const history = [...LAURA, msg('inbound', DATA), msg('outbound', 'Dame un momento y te confirmo 😊')]
    const s = deriveSalesState({ history, inboundText: '¿Cómo te pago?', ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.equal(s.dataReceived, true)
    assert.ok(formatSalesTurnBlock(CTX, s).includes(salesMethodQuestion(CTX)))
  })

  it('N2: data → sabor question → "Menta" comes back to the total + method question', () => {
    const history = [...LAURA, msg('inbound', DATA), msg('outbound', '¡Gracias! ¿Qué sabor preferís?')]
    const s = deriveSalesState({ history, inboundText: 'Menta', ctx: CTX })
    assert.equal(s.dataReceived, true)
  })

  it('N3: the step asks only for a missing field', () => {
    const s = deriveSalesState({ history: LAURA, inboundText: '85844314', ctx: CTX })
    assert.match(s.nextStep, /Si falta un dato de la lista/)
  })
})
