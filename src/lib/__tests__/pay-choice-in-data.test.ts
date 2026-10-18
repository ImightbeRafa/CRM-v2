/**
 * Rafael 2026-10-18 (getting customers to pay): a method choice written inside the order message ("Nombre: … Dirección:
 * … Envío a domicilio. Pago por SINPE 🙌") is a CHOICE when nothing about paying happened in the chat yet — never a
 * way to fake "ya pagué". Pinned both ways, including every bypass from SecureDog / Verifier round 1. Pure; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/pay-choice-in-data.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
