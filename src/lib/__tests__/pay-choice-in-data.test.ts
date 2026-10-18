/**
 * Rafael 2026-10-18 (getting customers to pay): a method choice written inside the order message ("Nombre: … Dirección:
 * … Envío a domicilio. Pago por SINPE 🙌") is a CHOICE when nothing about paying happened in the chat yet — never a
 * way to fake "ya pagué". Pinned both ways, including every bypass from SecureDog / Verifier round 1. Pure; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/pay-choice-in-data.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseBrandFacts, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { classifyPaymentText, embeddedPaymentChoice } from '@/lib/soft-ai/payment-classifier'
import { decideInbound, decisionOrderDataChoice } from '@/lib/soft-ai/inbound-decision'
import { decideBurstTurn } from '@/lib/soft-ai/burst-decision'
import { planBurstInbound } from '@/lib/soft-ai/inbound-burst'
import { deriveSalesState, nothingPaidYet, orderDataChoice, type SalesContext } from '@/lib/soft-ai/sales-state'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'

const FACTS: BrandFacts = parseBrandFacts({
  payment: {
    shareWithCustomers: true,
    methods: ['sinpe', 'tarjeta'],
    sinpe: { number: '62019914', holderName: 'Rafael García' },
  },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const CTX: SalesContext = {
  catalog: [{ name: 'Parches 1 bolsa', price: 9900, stockLabel: 'disponible' }],
  shippingMethods: [{ name: 'Correos', price: 3000, coverage: 'todo el país', cod: '' }],
  orderFields: ['Nombre', 'Teléfono'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['62019914'],
  paymentMethods: ['sinpe', 'tarjeta'],
  promo: null,
  bundles: [],
}
let n = 0
const msg = (direction: 'inbound' | 'outbound', content: string, messageType?: string) => ({
  id: `m-${n++}`,
  direction,
  content,
  sentAt: '',
  ...(messageType ? { messageType } : {}),
})
type Row = { direction: string; content: string; messageType?: string | null }

const SHOPPER = 'Nombre: Ana Mora\nTeléfono: 8888-8888\nDirección: Heredia centro, 200 m norte de la iglesia\nEnvío a domicilio. Pago por SINPE 🙌'
const LIST_LABELS = 'Nombre completo: Ana Mora\nTeléfono: 8888 8888\nCorreo (opcional): ana.mora@gmail.com\nProvincia: Heredia\nCantón: Heredia\nDistrito: Mercedes\nDirección exacta con señas: del parque 200 m al norte, casa 25\nPago por SINPE'
const ONE_LINE = 'Nombre: Ana Mora. Tel: 88888888. Dirección: San José, Curridabat. Envío a domicilio, pago por SINPE 🙌'
const CHOICES = [SHOPPER, LIST_LABELS, ONE_LINE, 'Pago por SINPE', 'pago con tarjeta', 'por sinpe', 'Pago por SINPE 🙌', 'Nombre: Ana\nForma de pago: SINPE']
const S = 'Pago por SINPE 🙌'
const CLAIMS = [
  'Ya pagué por SINPE 🙌',
  'Pagué por SINPE',
  'Pago por SINPE ✅',
  'pago por sinpe hecho',
  'les hice el sinpe',
  'Pago por SINPE, ¿les llegó?',
  'Pago por SINPE. Ayer',
  'Pago por SINPE 25000',
  'Pago por SINPE de 25 mil',
  'Pago por SINPE ₡12.900',
  'Pago por SINPE, ya',
  'Pago por SINPE. Listo',
  'Pago por SINPE, ahí va el comprobante',
  'Nombre: Ana\nPago por SINPE\nYa les mandé',
  'Nombre: Ana\nPago por SINPE\nRef 123456',
  'Nombre: Ana. Pago por SINPE. Lo hice hace rato',
  'Pago por SINPE, ¿me confirmás?',
  // Verifier r1 #1 / SecureDog r1 F2: a cue on its own line.
  'Pago por SINPE.\nHace 5 min', 'Pago por SINPE\nhace poco', 'Pago por SINPE\nacabo de hacerlo',
  'Pago por SINPE\n9900', 'Pago por SINPE\n9 900', 'Pago por SINPE\nMonto 9900', `${S}\n12 900`, `${S}\n2026101815420012345678`, `${S}\nCódigo 4821`, `${S}\nDesde el 8888-8888`,
  'Pago por SINPE\nyaa', 'Pago por SINPE\nlistoo', 'Pago por SINPE\nhechoo', 'Pago por SINPE\nsinpeado', `${S}\nListooo`, `${S}\nYaaa`, `${S}\nHechooo`, `${S}\nYastá`,
  'Pago por SINPE\nchequeen', 'Pago por SINPE\nfíjense porfa', 'Pago por SINPE\nme dicen si les entra',
  'Pago por SINPE\nla mitad', 'Pago por SINPE\nadelanto', 'Pago por SINPE\nsaldado', `${S}\nEl resto mañana`, `${S}\nDebo 3000`, `${S}\nPor error`, `${S}\nEso fue todo`,
  'Pago por SINPE\nme da error', 'Pago por SINPE\nno me deja', 'Pago por SINPE\ndoble',
  'Pago por SINPE\n¿Lo pueden revisar?', 'Pago por SINPE. ¿Me lo revisan?', `${S}\nRevisan porfa`, `${S}\n¿Pueden ver?`, `${S}\nAvísenme`,
  `${S}\nHace 5 minutos`, `${S}\nHace un toque`, `${S}\nAntier`, `${S}\nAnteayer`, `${S}\nHoy temprano`, `${S}\nRecién`, `${S}\nAhorita mismo`, `${S}\n3:15 pm`, `${S}\n15:42`, `${S}\n18/10/2026`, `${S}. Hace 10 min`, `${SHOPPER}\nHace 5 min`,
  'Pago por SINPE.\n👌', 'Pago por SINPE.\n✓', 'Pago por SINPE.\n📸',
  `${S}\nLo realicé hace un toque ¿sí?`, `${S}\nLe tiré hace 5 min, ¿va?`, `${S}\nLo efectué?`,
  // SecureDog r1 F5: look-alike / hidden spellings.
  `${S}\nУа`, `${S}\nListо`, `${S}\nY\u{E0020}a`, `${S}\nL i s t o`, `${S}\nList0`,
]
// A sales chat: price quoted, data asked — nothing about paying yet.
const SALES_HISTORY = [
  msg('inbound', 'Hola, ¿cuánto cuestan los parches?'),
  msg('outbound', 'Hola, la bolsa está en ₡9 900 y el envío por Correos ₡3 000.'),
  msg('inbound', 'Lo quiero'),
  msg('outbound', 'Para coordinar el envío, pasame: nombre completo, teléfono y dirección.'),
]
// The agent's own close: total, the fixed data list and the method question (Verifier r1 #2).
const CLOSE_HISTORY = [
  msg('inbound', 'Hola, quiero los parches'),
  msg('outbound', 'Serían ₡9 900 + ₡3 000 de envío = ₡12 900.'),
  msg('outbound', `Para coordinar el envío, pasame estos datos:\n${SHIPPING_DATA_LIST}`),
  msg('outbound', '¿Cómo preferís pagar? Tenemos SINPE y tarjeta.'),
]
const rows = (history: Row[], ...texts: Array<string | Row>) => [...history, ...texts.map((t) => (typeof t === 'string' ? { direction: 'inbound', content: t } : t))]
const decide = (inboundText: string, history: Row[] = SALES_HISTORY, extra: Record<string, unknown> = {}) =>
  decideInbound({
    inboundText,
    brandFacts: FACTS,
    shortcuts: SHORTCUTS,
    awaitingPaymentMethod: history === CLOSE_HISTORY,
    orderDataChoice: orderDataChoice(rows(history, { direction: 'inbound', content: inboundText, messageType: (extra.messageType as string) ?? null })),
    ...extra,
  })

describe('a choice inside the order data is a choice (nothing paid yet)', () => {
  it('classifier: choice texts → payment_info_safe only with the gate', () => {
    for (const t of CHOICES) {
      assert.ok(embeddedPaymentChoice(t), t)
      assert.equal(classifyPaymentText(t, { nothingPaidYet: true }), 'payment_info_safe', t)
    }
    // Without the gate the old behaviour stays (the shopper message was a hand-off).
    assert.equal(classifyPaymentText(SHOPPER), 'payment_proof_or_risk')
  })
  it('decision: the shopper message goes to the model with the SINPE choice (no hand-off)', () => {
    for (const history of [SALES_HISTORY, CLOSE_HISTORY]) {
      for (const t of [SHOPPER, LIST_LABELS, ONE_LINE, 'Pago por SINPE']) {
        const d = decide(t, history)
        assert.notEqual(d.paymentClass, 'payment_proof_or_risk', t)
        assert.equal(d.escalate, false, t)
        assert.equal(d.handoff, null, t)
        // After the store's method question a bare "Pago por SINPE" is the old exact-choice reply (code sends details).
        if (!(history === CLOSE_HISTORY && t === 'Pago por SINPE')) assert.equal(decisionOrderDataChoice(d), 'sinpe', t)
      }
    }
  })
  it('sales state: the pick is SINPE and the step asks for the total with shipping then the token', () => {
    const s = deriveSalesState({ history: SALES_HISTORY, inboundText: SHOPPER, ctx: CTX, dataChoice: 'sinpe' })
    assert.equal(s.chosenMethod, 'sinpe')
    assert.equal(s.stage, 'metodo_pago')
    assert.match(s.nextStep, /\[\[PAGO_SINPE\]\]/)
    assert.match(s.nextStep, /total exacto con envío/)
    // Never recomputed without the decision's say-so (SecureDog r1 F4).
    assert.notEqual(deriveSalesState({ history: SALES_HISTORY, inboundText: SHOPPER, ctx: CTX }).chosenMethod, 'sinpe')
  })
  it('the total line only for an offered method and a single unit (Verifier r1 #5 / #6)', () => {
    const cardOnly = { ...CTX, paymentMethods: ['tarjeta' as const] }
    assert.doesNotMatch(deriveSalesState({ history: SALES_HISTORY, inboundText: SHOPPER, ctx: cardOnly, dataChoice: 'sinpe' }).nextStep, /total exacto con envío/)
    const two = 'Quiero 2 bolsas.\nNombre: Ana Mora\nTeléfono: 8888-8888\nPago por SINPE'
    assert.doesNotMatch(deriveSalesState({ history: SALES_HISTORY, inboundText: two, ctx: CTX, dataChoice: 'sinpe' }).nextStep, /total exacto con envío/)
  })
  it('a burst of data bubbles is read as one message', () => {
    assert.equal(orderDataChoice(rows(SALES_HISTORY, 'Nombre: Ana Mora', 'Teléfono: 8888-8888', S)), 'sinpe')
  })
})

describe('a real claim stays a claim / hand-off', () => {
  it('claim texts are never an embedded choice and stay payment_proof_or_risk', () => {
    for (const t of CLAIMS) {
      assert.equal(embeddedPaymentChoice(t), null, t)
      assert.equal(orderDataChoice(rows(SALES_HISTORY, t)), null, t)
      for (const history of [SALES_HISTORY, CLOSE_HISTORY]) assert.equal(decide(t, history).paymentClass, 'payment_proof_or_risk', t)
    }
  })
  it('SecureDog r1 F1: a claim split into another bubble ends it (either order)', () => {
    for (const other of ['Listo', 'Ya', 'Ya está', 'Ya quedó', 'Ahí va', 'Hace 5 min', 'Hecho']) {
      assert.equal(orderDataChoice(rows(SALES_HISTORY, other, S)), null, other)
      assert.equal(orderDataChoice(rows(SALES_HISTORY, S, other)), null, other)
      for (const [first, second] of [[other, S], [S, other]]) {
        const history = [...SALES_HISTORY, msg('inbound', first)]
        const choice = orderDataChoice(rows(history, second))
        const base = { brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: choice }
        const trigger = { content: second, messageType: 'text' }
        const burstEarlier = [{ id: 'b1', direction: 'inbound' as const, content: first, messageType: 'text', sentAt: '' }]
        const burst = planBurstInbound({ trigger: { ...trigger, sentAt: '' }, earlier: burstEarlier, awaitingReceipt: () => false })
        const { decision } = decideBurstTurn({ burst, burstEarlier, trigger, history, mediaSalesContext: null, earlierCustomerTexts: [first], decisionBase: base })
        assert.equal(decisionOrderDataChoice(decision), null, `${first} + ${second}`)
      }
    }
  })
  it('two methods are never one data choice (the old path decides)', () => {
    for (const t of ['Pago por SINPE y transferencia', 'Pago por SINPE. Pago con tarjeta', 'Nombre: Ana. Pago por SINPE. Contra entrega']) {
      assert.equal(embeddedPaymentChoice(t), null, t)
      assert.equal(classifyPaymentText(t, { nothingPaidYet: true }), classifyPaymentText(t), t)
    }
  })
  it('unlabelled free lines are not order data (allowlist: label + value, phone, delivery phrase, greeting)', () => {
    for (const t of ['Ana Mora\n8888-8888\nHeredia\nPago por SINPE', 'Pago por SINPE\nla otra parte mañana', 'Nombre: hace poco\nPago por SINPE', 'Dirección: me da error\nPago por SINPE']) {
      assert.equal(embeddedPaymentChoice(t), null, t)
    }
  })
  it('a photo + "pago por sinpe" stays a receipt hand-off', () => {
    const d = decide('pago por sinpe', SALES_HISTORY, { messageType: 'image' })
    assert.notEqual(d.paymentClass, 'payment_info_safe')
    assert.ok(d.escalate || d.handoff, 'photo goes to a person')
    // An earlier photo / placeholder in the chat ends "nothing paid yet" too.
    for (const extra of [msg('inbound', '', 'image'), msg('inbound', '[share]'), msg('inbound', '[ig_story]')]) {
      const withPhoto = [...SALES_HISTORY, extra]
      assert.equal(orderDataChoice(rows(withPhoto, SHOPPER)), null)
      assert.equal(decide(SHOPPER, withPhoto).paymentClass, 'payment_proof_or_risk')
    }
  })
  it('the same choice text AFTER the store sent payment details stays a hand-off (blocks and typed by a person)', () => {
    const details = [
      'SINPE Móvil: 6201 9914\nA nombre de: Rafael García\nCuando lo hagás, mandame el comprobante 😊',
      'SINPE: 6201-99-14 a nombre de Rafael García',
      'Al 62 01 99 14 a nombre de Rafael García',
      'Podés hacerlo al 6201-99-14 (Rafael García) y me pasás la foto',
      'Una persona del equipo valida tu pago',
      'Mandame el comprobante cuando puedas',
      '¿Ya pudiste hacer el SINPE?',
      'Vi tu depósito, gracias',
    ]
    for (const out of details) {
      const after = [...SALES_HISTORY, msg('outbound', out)]
      assert.equal(nothingPaidYet(rows(after, SHOPPER), { paymentDigits: ['62019914'] }), false, out)
      for (const t of [SHOPPER, 'Pago por SINPE', S]) {
        const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: orderDataChoice(rows(after, t), { paymentDigits: ['62019914'] }) })
        assert.equal(d.paymentClass, 'payment_proof_or_risk', `${out} → ${t}`)
      }
    }
  })
  it('ordinary store wording keeps the gate open (Verifier r1 #4)', () => {
    for (const out of ['¡Listo! Para coordinar el envío, pasame tus datos', 'Ya te ayudo 😊', '✅ Envío a todo el país', 'Perfecto 👌']) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('outbound', out)], SHOPPER)), true, out)
    }
  })
  it('an earlier claim from the customer ends "nothing paid yet"', () => {
    const claimed = [...SALES_HISTORY, msg('inbound', 'Ya les pagué')]
    assert.equal(nothingPaidYet(rows(claimed, SHOPPER)), false)
    // A burst with a claim bubble stays a hand-off.
    const d = decideInbound({ inboundText: SHOPPER, brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: 'sinpe', earlierCustomerTexts: ['ya hice el sinpe'] })
    assert.equal(d.paymentClass, 'payment_proof_or_risk')
  })
  it('a full history window fails closed', () => {
    assert.equal(nothingPaidYet(rows(SALES_HISTORY, SHOPPER), { windowFull: true }), false)
    assert.equal(orderDataChoice(rows(SALES_HISTORY, SHOPPER), { windowFull: true }), null)
  })
  it('the gate is off while waiting for a receipt', () => {
    const d = decideInbound({ inboundText: SHOPPER, brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: 'sinpe', awaitingReceipt: true })
    assert.equal(d.paymentClass, 'payment_proof_or_risk')
  })
})

describe('round 2 (Verifier r2 + SecureDog r2)', () => {
  const N = 'Nombre: Ana Mora\n'
  // SecureDog r2 INT-A (hard claims the live classifier already hands off), INT-B (claims hidden in a label value),
  // INT-D (Latin look-alikes, letter-spacing, odd line breaks), Verifier r2 F4.
  const CLAIMS_R2 = [
    `${N}Dirección: Heredia, le dejé la plata en la cuenta\nPago por SINPE`,
    `${N}Señas: le giré la plata\nPago por SINPE`,
    `${N}Dirección: Heredia, le metí la plata\nPago por SINPE`,
    `${N}Dirección: Heredia, le completé la plata\nPago por SINPE`,
    `${N}Dirección: Heredia, se lo adelanté\nPago por SINPE`,
    `${N}Dirección: Heredia, paid\nPago por SINPE`,
    `${N}Dirección: Heredia, done\nPago por SINPE`,
    `${N}Dirección: Heredia, sent\nPago por SINPE`,
    `${N}Dirección: Heredia, paɡué\nPago por SINPE`,
    `${N}Dirección: Heredia, ya­pagué\nPago por SINPE`,
    `${N}Teléfono: 8888-8888\nDirección: Heredia, le puse la plata\nPago por SINPE 🙌`,
    'Nombre: Ana Mora, le puse la plata, pago por SINPE',
    `${N}Dirección: Heredia, pagao\nPago por SINPE`,
    `${N}Dirección: Heredia, cancelao\nPago por SINPE`,
    `${N}Dirección: Heredia, le dejamos el dinero\nPago por SINPE`,
    `${N}Dirección: Heredia, la plata está puesta\nPago por SINPE`,
    `${N}Dirección: Heredia, le puse la platica\nPago por SINPE`,
    `${N}Dirección: Heredia, le puse la harina\nPago por SINPE`,
    `${N}Dirección: Heredia, le puse la plata al cel de la bio\nPago por SINPE`,
    `${N}Dirección: Heredia, le puse 12 900\nPago por SINPE`,
    `${N}Dirección: Heredia, le puse los 9 900\nPago por SINPE`,
    `${N}Dirección: Heredia 12 900\nPago por SINPE`,
    `${N}Dirección: Heredia, ahí el print del banco\nPago por SINPE`,
    `${N}Dirección: Heredia, ahí la imagen del banco\nPago por SINPE`,
    `${N}Pago por SINPE\nNombre: le puse la plata`,
    'Pago: SINPE\nSeñas: le puse la plata',
    'Pago por SINPE\nSeñas: le dejé la plata al guarda',
    'Pago por SINPE\nSeñas: giré',
    'Pago por SINPE\nSeñas: lo gire',
    `${N}Dirección: Heredia, ʟɪsᴛᴏ\nPago por SINPE`,
    `${N}Dirección: Heredia, ʏᴀ\nPago por SINPE`,
    `${N}Dirección: Heredia, l i s t o\nPago por SINPE`,
    `${N}Dirección: Heredia, p a g u e\nPago por SINPE`,
    'Nombre: Ana Mora ya le hice el sinpe\nPago por SINPE',
    'Nombre: Ana Mora\u0085ya\u0085le\u0085hice\u0085el\u0085sinpe\nPago por SINPE',
    'Nombre: Ana Mora\u000Bya\u000Ble\u000Bhice\u000Bel\u000Bsinpe\nPago por SINPE',
  ]
  it('claims hidden in the data are never an embedded choice', () => {
    for (const t of CLAIMS_R2) {
      assert.equal(embeddedPaymentChoice(t), null, t)
      assert.equal(orderDataChoice(rows(SALES_HISTORY, t)), null, t)
      assert.notEqual(classifyPaymentText(t, { nothingPaidYet: true }), 'payment_info_safe', t)
    }
  })
  it('a claim split into a data bubble + the choice bubble stays out', () => {
    assert.equal(orderDataChoice(rows(SALES_HISTORY, 'Dirección: Heredia, le puse la plata', S)), null)
  })
  it('legit addresses still pass (accents, landmarks, banks as landmarks)', () => {
    for (const t of [
      `${N}Dirección: San José, Pérez Zeledón, frente al café\nPago por SINPE`,
      `${N}Dirección: Jacó, 200 m sur del BCR\nPago por SINPE`,
      `${N}Dirección: Belén, Sarapiquí, casa 25\nPago por SINPE 🙌`,
    ]) {
      assert.equal(embeddedPaymentChoice(t), 'sinpe', t)
    }
  })
  it('Verifier r2 F1: the store\'s list ("Nombre completo") + another bubble / a later message continues', () => {
    // An earlier list bubble is not a hard claim in the burst.
    for (const trigger of ['Gracias 🙏', 'Envío a domicilio']) {
      const d = decideInbound({ inboundText: trigger, brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: orderDataChoice(rows(SALES_HISTORY, LIST_LABELS, trigger)), earlierCustomerTexts: [LIST_LABELS] })
      assert.notEqual(d.paymentClass, 'payment_proof_or_risk', trigger)
      assert.equal(d.handoff, null, trigger)
    }
    // A follow-up after the agent answered the list (earlierCustomerTexts = recent customer texts).
    for (const trigger of ['Gracias', 'Ok', '¿Cuánto tarda el envío?']) {
      const d = decideInbound({ inboundText: trigger, brandFacts: FACTS, shortcuts: SHORTCUTS, earlierCustomerTexts: [LIST_LABELS] })
      assert.notEqual(d.paymentClass, 'payment_proof_or_risk', trigger)
    }
    // Through the burst path exactly as live.
    const history = [...SALES_HISTORY, msg('inbound', LIST_LABELS)]
    const trigger = { content: 'Gracias 🙏', messageType: 'text' }
    const burstEarlier = [{ id: 'b1', direction: 'inbound' as const, content: LIST_LABELS, messageType: 'text', sentAt: '' }]
    const burst = planBurstInbound({ trigger: { ...trigger, sentAt: '' }, earlier: burstEarlier, awaitingReceipt: () => false })
    const base = { brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: orderDataChoice(rows(history, 'Gracias 🙏')) }
    const { decision } = decideBurstTurn({ burst, burstEarlier, trigger, history, mediaSalesContext: null, earlierCustomerTexts: [LIST_LABELS], decisionBase: base })
    assert.equal(decisionOrderDataChoice(decision), 'sinpe')
    assert.equal(decision.handoff, null)
  })
  it('Verifier r2 F3: the store\'s own SINPE number typed by the customer ends "nothing paid yet"', () => {
    for (const t of ['Nombre: Ana\nPago por SINPE\n6201-9914', 'Nombre: Ana\nTel: 6201-9914\nPago por SINPE', 'Nombre: Ana\nTeléfono: 62019914\nPago por SINPE']) {
      assert.equal(orderDataChoice(rows(SALES_HISTORY, t), { paymentDigits: ['62019914'] }), null, t)
    }
    assert.equal(orderDataChoice(rows(SALES_HISTORY, S, 'Nombre: Ana Mora', '6201-9914'), { paymentDigits: ['62019914'] }), null)
  })
  it('SecureDog r2 INT-C: store thanks / number elsewhere / receipt-photo ask close the gate', () => {
    for (const out of [
      'Gracias por el SINPE 🙏 pasame tus datos',
      'Gracias por tu compra 😊 pasame los datos del envío',
      'Hacelo al número de la bio 😊',
      'El SINPE está en la bio',
      'Pagás por SINPE y me mandás la foto 😊',
      'Mandame la foto cuando lo hagás',
      'Te paso el SINPE por privado',
      'Al 62 01 99 14, Rafael García',
    ]) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('outbound', out)], SHOPPER)), false, out)
    }
    // Ordinary sales talk about photos of the product keeps it open.
    assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('outbound', 'Te mando fotos del producto 😊')], SHOPPER)), true)
  })
  it('SecureDog r2 INT-E: an oversized history row fails closed and stays fast', () => {
    const big = Array.from({ length: 12 }, () => msg('inbound', `Nombre: Ana${' \n'.repeat(2000)}`))
    // Whitespace padding is collapsed before the per-row checks (SecureDog measured ~540 ms per turn before).
    const t0 = Date.now()
    orderDataChoice(rows([...SALES_HISTORY, ...big], SHOPPER))
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`)
    // A row that is still long after collapsing fails closed.
    assert.equal(orderDataChoice(rows([...SALES_HISTORY, msg('inbound', 'Hola '.repeat(300))], SHOPPER)), null)
  })
  it('Verifier r2 F5 / INT-F: efectivo / contra entrega inside the data reach sales-state', () => {
    const cod = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe', 'efectivo', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' } } })
    const t = 'Nombre: Ana Mora\nTeléfono: 8888-8888\nPago en efectivo'
    const choice = orderDataChoice(rows(SALES_HISTORY, t))
    assert.equal(choice, 'efectivo')
    const d = decideInbound({ inboundText: t, brandFacts: cod, shortcuts: SHORTCUTS, orderDataChoice: choice })
    assert.equal(decisionOrderDataChoice(d), 'efectivo')
  })
})

describe('round 3 (Verifier r3)', () => {
  const N = 'Nombre: Ana Mora\n'
  it('F2: typical CR order data still routes as a choice', () => {
    for (const t of [
      `${N}Dirección: Heredia, San Rafael, de la iglesia 200 m norte y 50 m este, casa color verde con portón negro, mano derecha\nPago por SINPE`,
      `Nombre completo: Ana Mora\nTeléfono: 8888 8888\nDirección exacta con señas: de la escuela de Mercedes Norte 300 m este y 100 m sur, casa esquinera color verde, portón negro, mano derecha\nPago por SINPE`,
      'Nombre: María de los Ángeles Rodríguez Castro\nPago por SINPE',
      'Nombre: José Francisco Rodríguez de la Cruz\nPago por SINPE',
      `${N}Dirección: Residencial Los Arcos, casa número 25\nPago por SINPE`,
      `${N}Dirección: Heredia, casa número 10\nEnvío a domicilio\nPago por SINPE`,
      `${N}Dirección: Grecia, 200 m norte del puesto de salud\nPago por SINPE`,
      `${N}Dirección: contiguo al puesto de la Fuerza Pública\nPago por SINPE`,
      `${N}Dirección: Urbanización La Puesta del Sol, casa 12\nPago por SINPE`,
    ]) {
      assert.equal(embeddedPaymentChoice(t), 'sinpe', t)
      assert.equal(orderDataChoice(rows(SALES_HISTORY, t)), 'sinpe', t)
    }
  })
  it('F1: hand-typed details with the holder on the next line close the gate', () => {
    for (const out of ['Podés hacerlo al 7012-3456\nA nombre de Rafael García', 'Al 7012-3456\nA nombre de Rafael García', 'A nombre de Rafael García\n7012-3456']) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('outbound', out)], SHOPPER), { paymentDigits: ['62019914'] }), false, out)
    }
  })
  it('F3: ordinary store sales talk keeps the gate open', () => {
    for (const out of [
      'Si querés un cambio de talla, pasame tus datos',
      'Hacemos cambios 😊 pasame tu número de pedido',
      'El admin te confirma el número de guía',
      'Para el retiro pasame tu nombre completo, número de teléfono y correo 😊',
      'Pasame tu número y correo para coordinar',
      '¿Me mandás una foto de lo que viste en la historia?',
      'Pasame la foto del modelo que te gustó',
      'Mandame una foto de la referencia 😊',
      'Me pasás el print de la talla que usás?',
      'Tenemos tallas 36 38 40 42',
      'Disponible en 34-36-38-40',
      `¡Hola! Bienvenida a la tienda. ${'Tenemos envíos a todo el país y retiro en tienda. '.repeat(25)}`,
    ]) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('outbound', out)], SHOPPER)), true, out)
    }
  })
  it('F4: a done word split in two or three chunks is not order data', () => {
    for (const t of [`${N}Dirección: Heredia, lis to\nPago por SINPE`, `${N}Dirección: Heredia, li sto\nPago por SINPE`, `${N}Dirección: Heredia, li s to\nPago por SINPE`, `${N}Señas: pa gué\nPago por SINPE`]) {
      assert.equal(embeddedPaymentChoice(t), null, t)
    }
  })
  it('F5: an earlier customer row with odd line breaks ends "nothing paid yet"', () => {
    const glued = [...SALES_HISTORY, msg('inbound', 'ya\u0085pagué'), msg('outbound', 'Perfecto 👌')]
    assert.equal(nothingPaidYet(rows(glued, SHOPPER)), false)
  })
})

describe('round 3 (SecureDog r3)', () => {
  const D = (x: string) => `Nombre: Ana Mora\nDirección: Heredia, ${x}\nPago por SINPE`
  it('INT-G: invisible characters are rejected, never stripped (no glued claim)', () => {
    for (const c of ['​', '‌', '‍', '­', '⁠', '﻿', '‎', '\u{E0020}', '͏']) {
      for (const w of [`ya${c}lo${c}hice`, `le${c}puse`, `ya${c}pague`, `ya${c}esta`, `se${c}lo${c}pague`]) {
        assert.equal(embeddedPaymentChoice(D(w)), null, JSON.stringify(w))
        assert.equal(orderDataChoice(rows(SALES_HISTORY, D(w))), null, JSON.stringify(w))
      }
    }
    // An earlier glued bubble keeps the burst hand-off and closes the gate for later rows.
    const glued = D('ya\u{E0020}pague')
    const d = decideInbound({ inboundText: 'Gracias 🙏', brandFacts: FACTS, shortcuts: SHORTCUTS, orderDataChoice: 'sinpe', earlierCustomerTexts: [glued] })
    assert.equal(d.paymentClass, 'payment_proof_or_risk')
    assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('inbound', glued), msg('outbound', 'Perfecto 😊')], SHOPPER)), false)
  })
  it('INT-H: CR claim wording inside a free value is not order data', () => {
    for (const w of [
      'se lo tiramos', 'le tiramos', 'le adelantamos', 'le cubrimos', 'liquidado', 'girado', 'girada', 'adelantado', 'debitado',
      'rebajado', 'descontado', 'tramitado', 'ejecutada', 'concretado', 'transacción finalizada', 'mandao', 'enviao', 'pasao',
      'tirao', 'girao', 'dejao', 'depositao', 'metio', 'le complete', 'liquide', 'lo cubri', 'kancele', 'listísimo', 'listisimo',
      'hechísimo', 'lizto', 'hexo', 'la transfe', 'ahí la transfe', 'el depo', 'ahí el depo', 'desde el BAC', 'desde el BCR',
      'desde el BN', 'desde mi banco', 'por la app del banco', 'app del BAC', 'ahí lo tienen', 'ahí tiene', 'al día',
      'estamos al día', 'payment made', 'wired',
    ]) {
      assert.equal(embeddedPaymentChoice(D(w)), null, w)
    }
    // Position: the claim line after "Pago por SINPE".
    for (const w of ['ahí le cae', 'ahí les cae', 'desde mi banco']) {
      assert.equal(embeddedPaymentChoice(`Nombre: Ana Mora\nPago por SINPE\nDirección: Heredia, ${w}`), null, w)
    }
  })
  it('INT-I: an earlier done / money row the live classifier misses closes the gate', () => {
    for (const x of ['Le puse la plata', 'pagao', 'Ahí les cae', 'Ahí le cae', 'Se lo tiramos', 'Liquidado', 'Listo', 'Ya', 'ya está', 'Ya le puse']) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('inbound', x), msg('outbound', 'Perfecto 😊')], SHOPPER)), false, x)
    }
    // Questions keep it open.
    for (const x of ['¿Aceptan SINPE?', '¿Cuánto es?', '¿Ya tienen la talla M?']) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('inbound', x), msg('outbound', 'Sí 😊')], SHOPPER)), true, x)
    }
  })
  it('INT-J: look-alike letters and digits glued to letters are not order data', () => {
    for (const w of ['lısto', 'hıce el sınpe', 'Lısto', 'lıstø', 'łisto', 'ƴa', 'l1sto', 'hech0', 'pagu3', 'p4gue', 'y4']) {
      assert.equal(embeddedPaymentChoice(D(w)), null, w)
    }
    assert.equal(embeddedPaymentChoice(D('casa 25, 2da entrada')), 'sinpe')
  })
  it('INT-K: more store wordings close the gate', () => {
    for (const out of [
      'SINPE a este número 😊', 'Hacelo a este número', 'Al mismo número de aquí', 'A este mismo número', 'Mi número es el mismo de WhatsApp',
      'Al número de este chat', 'Te dejo el QR', 'Escaneá el QR', 'El número está en la descripción', 'El SINPE está en los destacados',
      'El número está en el post', 'Cuando pagués me avisás 😊', 'Cuando lo hagás me decís', 'Apenas me caiga te confirmo',
      'Cuando me entre te aviso', 'Pagás y te lo mando', 'me pasás la evidencia', 'me mandás el respaldo', 'Ya tenés los datos',
      'Al de siempre 😊', 'Ya sabés el número 😊',
    ]) {
      assert.equal(nothingPaidYet(rows([...SALES_HISTORY, msg('outbound', out)], SHOPPER)), false, out)
    }
  })
  it('INT-L / INT-M: spoken / spaced amounts and a bare "puesto" are not order data', () => {
    for (const w of ['doce novecientos', 'nueve novecientos', 'los doce novecientos', 'doce nueve', '1 2 9 0 0', '12 9 00', 'puesto']) {
      assert.equal(embeddedPaymentChoice(D(w)), null, w)
    }
    for (const w of ['200 m norte del puesto de salud', 'doscientos metros al norte']) assert.equal(embeddedPaymentChoice(D(w)), 'sinpe', w)
  })
  it('INT-H backstop: the "¿ya pagó?" model check is always enforced on an order-data choice', () => {
    const src = readFileSync(resolve('src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(src, /const dataChoicePath = decisionOrderDataChoice\(decision\) !== null/)
    assert.match(src, /const mode = dataChoicePath \? 'enforce' : paymentCheckMode\(\)/)
    assert.match(src, /if \(!dataChoicePath && !paymentCheckGate\(/)
  })
})
