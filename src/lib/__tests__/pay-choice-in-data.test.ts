/**
 * Rafael 2026-10-18 (getting customers to pay): a method choice written inside the order message ("Nombre: … Dirección:
 * … Envío a domicilio. Pago por SINPE 🙌") is a CHOICE when nothing about paying happened in the chat yet — never a
 * way to fake "ya pagué". Pinned both ways. Pure; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/pay-choice-in-data.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseBrandFacts, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { classifyPaymentText, embeddedPaymentChoice } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { deriveSalesState, nothingPaidYet, type SalesContext } from '@/lib/soft-ai/sales-state'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'

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

const SHOPPER = 'Nombre: Ana Mora\nTeléfono: 8888-8888\nDirección: Heredia centro, 200 m norte de la iglesia\nEnvío a domicilio. Pago por SINPE 🙌'
const ONE_LINE = 'Nombre: Ana Mora, Tel 88888888, Dirección: San José, Curridabat. Envío a domicilio. Pago por SINPE 🙌'
const CHOICES = [SHOPPER, ONE_LINE, 'Pago por SINPE', 'pago con tarjeta', 'por sinpe', 'Pago por SINPE 🙌']
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
]
// A sales chat: price quoted, data asked — nothing about paying yet.
const SALES_HISTORY = [
  msg('inbound', 'Hola, ¿cuánto cuestan los parches?'),
  msg('outbound', 'Hola, la bolsa está en ₡9 900 y el envío por Correos ₡3 000.'),
  msg('inbound', 'Lo quiero'),
  msg('outbound', 'Para coordinar el envío, pasame: nombre completo, teléfono y dirección.'),
]
const decide = (inboundText: string, history = SALES_HISTORY, extra: Record<string, unknown> = {}) =>
  decideInbound({
    inboundText,
    brandFacts: FACTS,
    shortcuts: SHORTCUTS,
    nothingPaidYet: nothingPaidYet([...history, { direction: 'inbound', content: inboundText, messageType: (extra.messageType as string) ?? null }]),
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
    for (const t of [SHOPPER, ONE_LINE, 'Pago por SINPE']) {
      const d = decide(t)
      assert.equal(d.paymentClass, 'payment_info_safe', t)
      assert.equal(d.escalate, false, t)
      assert.equal(d.handoff, null, t)
      assert.ok(d.decisionTrace.steps.some((s) => s.step === 'payment_choice' && s.reason === 'order_data_sinpe'), t)
    }
  })
  it('sales state: the pick is SINPE and the step asks for the total with shipping then the token', () => {
    const s = deriveSalesState({ history: SALES_HISTORY, inboundText: SHOPPER, ctx: CTX })
    assert.equal(s.chosenMethod, 'sinpe')
    assert.equal(s.stage, 'metodo_pago')
    assert.match(s.nextStep, /\[\[PAGO_SINPE\]\]/)
    assert.match(s.nextStep, /total exacto con envío/)
  })
})

describe('a real claim stays a claim / hand-off', () => {
  it('claim texts are never an embedded choice and stay payment_proof_or_risk', () => {
    for (const t of CLAIMS) {
      assert.equal(embeddedPaymentChoice(t), null, t)
      assert.equal(classifyPaymentText(t, { nothingPaidYet: true }), 'payment_proof_or_risk', t)
      const d = decide(t)
      assert.equal(d.paymentClass, 'payment_proof_or_risk', t)
    }
  })
  it('two methods are never one data choice (the old path decides)', () => {
    for (const t of ['Pago por SINPE y transferencia', 'Pago por SINPE. Pago con tarjeta', 'Nombre: Ana. Pago por SINPE. Contra entrega']) {
      assert.equal(embeddedPaymentChoice(t), null, t)
      assert.equal(classifyPaymentText(t, { nothingPaidYet: true }), classifyPaymentText(t), t)
    }
  })
  it('a photo + "pago por sinpe" stays a receipt hand-off', () => {
    const d = decide('pago por sinpe', SALES_HISTORY, { messageType: 'image' })
    assert.notEqual(d.paymentClass, 'payment_info_safe')
    assert.ok(d.escalate || d.handoff, 'photo goes to a person')
    // An earlier photo in the chat ends "nothing paid yet" too.
    const withPhoto = [...SALES_HISTORY, msg('inbound', '', 'image')]
    assert.equal(nothingPaidYet([...withPhoto, { direction: 'inbound', content: SHOPPER }]), false)
    assert.equal(decide(SHOPPER, withPhoto).paymentClass, 'payment_proof_or_risk')
  })
  it('the same choice text AFTER the store sent the SINPE details stays a hand-off', () => {
    const after = [...SALES_HISTORY, msg('outbound', 'SINPE Móvil: 6201 9914\nA nombre de: Rafael García\nCuando lo hagás, mandame el comprobante 😊')]
    assert.equal(nothingPaidYet([...after, { direction: 'inbound', content: SHOPPER }]), false)
    for (const t of [SHOPPER, 'Pago por SINPE', 'Pago por SINPE 🙌']) {
      assert.equal(decide(t, after).paymentClass, 'payment_proof_or_risk', t)
    }
    // Receipt talk / a payment-state question from the store ends it too.
    assert.equal(nothingPaidYet([...SALES_HISTORY, msg('outbound', '¿Ya pudiste hacer el SINPE?')]), false)
    assert.equal(nothingPaidYet([...SALES_HISTORY, msg('outbound', 'Mandame el comprobante cuando puedas')]), false)
  })
  it('an earlier claim from the customer ends "nothing paid yet"', () => {
    const claimed = [...SALES_HISTORY, msg('inbound', 'Ya les pagué')]
    assert.equal(nothingPaidYet([...claimed, { direction: 'inbound', content: SHOPPER }]), false)
    // A burst with a claim bubble stays a hand-off.
    const d = decideInbound({ inboundText: SHOPPER, brandFacts: FACTS, shortcuts: SHORTCUTS, nothingPaidYet: true, earlierCustomerTexts: ['ya hice el sinpe'] })
    assert.equal(d.paymentClass, 'payment_proof_or_risk')
  })
  it('a full history window fails closed', () => {
    const long = Array.from({ length: 24 }, (_, i) => msg(i % 2 ? 'outbound' : 'inbound', 'hola'))
    assert.equal(nothingPaidYet(long), false)
  })
  it('the gate is off while waiting for a receipt or the method question (other routes own those)', () => {
    const d = decideInbound({ inboundText: SHOPPER, brandFacts: FACTS, shortcuts: SHORTCUTS, nothingPaidYet: true, awaitingReceipt: true })
    assert.equal(d.paymentClass, 'payment_proof_or_risk')
  })
})
