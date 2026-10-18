/**
 * Sleeping Patches exam (2026-10-18) engine findings C1–C6, each case pinned. Pure helpers + small fakes; no DB.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/sleeping-exam-fixes.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBrandFacts, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { applyFinalOutputPolicy, splitReplyParts, unitDerivedAmount, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import {
  awaitingPaymentMethodChoice,
  dataListBeforePaymentQuestion,
  deriveSalesState,
  formatSalesTurnBlock,
  isPaymentMethodQuestion,
  noPaymentYet,
  salesDataListFirst,
  type SalesContext,
} from '@/lib/soft-ai/sales-state'
import { classifyPaymentText, hasHardPaymentClaim, isBareOrderConfirmAsk, isHowPayShipQuestion } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { PICKUP_DATA_LIST, SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'
import { activeLock, acquireTestLock, releaseTestLock, LOCK_TTL_MS, type LockDb } from '../../../scripts/agent-pack/test-lock'
import { examHistoryTimes } from '../../../scripts/agent-pack/exam-bank'

const FACTS: BrandFacts = parseBrandFacts({
  website: 'https://tienda.example.cr',
  shipping: { contraEntrega: { enabled: true, text: 'Pagás al recibir, al mensajero. Solo dentro del GAM.' } },
  payment: {
    shareWithCustomers: true,
    methods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'],
    sinpe: { number: '62019914', holderName: 'Rafael García' },
    transfer: { bank: 'BAC', iban: 'CR05015202001026284066', holderName: 'Rafael García' },
  },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const CTX: SalesContext = {
  catalog: [{ name: 'Sleeping Patches 1 bolsa', price: 9900, stockLabel: 'disponible' }],
  shippingMethods: [{ name: 'Correos', price: 3000, coverage: 'todo el país', cod: 'solo GAM' }],
  orderFields: ['Nombre', 'Teléfono'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['62019914'],
  promo: null,
  bundles: [
    { name: 'Pack de 2', price: 19800, shippingIncluded: true },
    { name: 'Pack de 3', price: 28500, shippingIncluded: true },
  ],
  paymentMethods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'],
  cardOnWeb: true,
}
let n = 0
const msg = (direction: 'inbound' | 'outbound', content: string, messageType?: string) => ({
  id: `m-${n++}`,
  direction,
  content,
  sentAt: '',
  ...(messageType ? { messageType } : {}),
})

describe('C1: a method choice after ANY payment-method question is a choice, not a payment claim', () => {
  const QUESTIONS = [
    '¿Cómo preferís pagar?',
    '¿Querés pagar por SINPE o tarjeta?',
    'Perfecto 🙌 ¿Preferís pagar con SINPE Móvil?',
    '¿Querés pagarlo por SINPE?',
    '¿Pagás por SINPE o en la web con tarjeta?',
    '¿SINPE o transferencia?',
    '¿Por SINPE o contra entrega?',
    'Tenemos SINPE Móvil, transferencia y tarjeta. ¿Cuál preferís?',
    '¿Le gustaría pagar por transferencia?',
  ]
  const NOT_QUESTIONS = [
    '¿Ya pudiste pagar por SINPE?',
    '¿Hiciste el SINPE o la transferencia?',
    'Si querés pagar por SINPE te paso el número.',
    '¿Ya pagaste por SINPE o tarjeta?',
    '¿Te llegó el SINPE o la transferencia?',
    '¿Cuál preferís, la de 30 o la de 60?',
    'Podés pagar con SINPE.',
  ]
  it('recognises the method question in its other wordings', () => {
    for (const q of QUESTIONS) assert.equal(isPaymentMethodQuestion(q), true, q)
  })
  it('never a question about a payment already made, a statement, or a non-payment "¿cuál preferís?"', () => {
    for (const q of NOT_QUESTIONS) assert.equal(isPaymentMethodQuestion(q), false, q)
  })
  it('after "¿Querés pagar por SINPE…?" a bare "sinpe" gets the SINPE details (the sale goes on)', () => {
    const history = [msg('inbound', 'Quiero el pack de 2'), msg('outbound', 'El pack de 2 cuesta ₡19 800 con envío incluido.\n\n¿Querés pagar por SINPE o tarjeta?')]
    assert.equal(awaitingPaymentMethodChoice(history), true)
    for (const text of ['sinpe', 'Sinpe', 'por sinpe porfa', 'SINPE']) {
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: awaitingPaymentMethodChoice(history) })
      assert.equal(d.paymentClass, 'non_payment', text)
      assert.equal(d.escalate, false, text)
      assert.match(d.text, /SINPE Móvil: 6201 9914/, text)
    }
  })
  it('a claim after the wider question is still a claim (a person)', () => {
    for (const text of ['ya hice el sinpe', 'sinpe ✅', 'Sinpe pagado', 'hecho por sinpe', 'te mandé por sinpe']) {
      const d = decideInbound({ inboundText: text, brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: true })
      assert.equal(d.paymentClass, 'payment_proof_or_risk', text)
    }
  })
  it('after a question about a done payment, a bare "sinpe" is NOT a choice (stays with a person)', () => {
    const history = [msg('outbound', '¿Ya pudiste pagar por SINPE?')]
    assert.equal(awaitingPaymentMethodChoice(history), false)
    const d = decideInbound({ inboundText: 'sinpe', brandFacts: FACTS, shortcuts: SHORTCUTS, awaitingPaymentMethod: false })
    assert.equal(d.paymentClass, 'payment_proof_or_risk')
  })
})

describe('C2: bare order-confirm asks are not payment claims when nothing about paying happened yet', () => {
  const BARE = ['Para confirmar el pedido!?', 'Buen día!\nPara confirmar el pedido!?', 'Buenas disculpe quisiera confirmar el pedido?!', 'Pura vida, me confirmás entonces?', 'me confirmás?']
  const STILL_CLAIMS = [
    'Confirmame que lo recibieron',
    'Revisen porfa',
    '¿me confirmás el sinpe?',
    'ya me confirmás?',
    '¿me confirmás que llegó?',
    'Confirmame el pedido ORD-1234',
    'confirmame el pago porfa',
    'me confirman si les cayó?',
    'Para confirmar el pedido, ya les hice el sinpe',
  ]
  it('isBareOrderConfirmAsk: only the bare asks', () => {
    for (const t of BARE) assert.equal(isBareOrderConfirmAsk(t), true, t)
    for (const t of STILL_CLAIMS) assert.equal(isBareOrderConfirmAsk(t), false, t)
  })
  it('classifier: answered with noPaymentYet; INT-93 behaviour kept otherwise', () => {
    for (const t of BARE) {
      assert.equal(classifyPaymentText(t, { noPaymentYet: true }), 'non_payment', t)
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
      assert.equal(hasHardPaymentClaim(t, { noPaymentYet: true }), false, t)
      assert.equal(hasHardPaymentClaim(t), true, t)
    }
    for (const t of STILL_CLAIMS) assert.equal(classifyPaymentText(t, { noPaymentYet: true }), 'payment_proof_or_risk', t)
  })
  it('"si realizó un pedido, cuánto duran en entregarlo?" is a delivery question, never a claim', () => {
    for (const t of ['Me pueden indicar si realizo un pedido del Sleeping parches, cuánto duran en entregarlo en la zona de San Sebastián', '¿Buenas, si realizó un pedido, cuánto duran en entregarlo?']) {
      assert.equal(classifyPaymentText(t), 'non_payment', t)
      assert.equal(hasHardPaymentClaim(t), false, t)
    }
  })
  it('noPaymentYet: false as soon as anything about paying is in the chat', () => {
    assert.equal(noPaymentYet([msg('inbound', 'Hola'), msg('outbound', '¡Hola! ¿En qué te ayudo?'), msg('inbound', 'Para confirmar el pedido!?')]), true)
    assert.equal(noPaymentYet([msg('outbound', '¿Cómo preferís pagar? Tenemos SINPE Móvil y tarjeta.')]), true)
    const notYet = [
      [msg('outbound', 'SINPE Móvil: 6201 9914\nA nombre de: Rafael García')],
      [msg('outbound', 'Pago contra entrega:\nPagás al recibir.')],
      [msg('inbound', '', 'image')],
      [msg('inbound', '[imagen]')],
      [msg('inbound', 'ya pagué')],
      [msg('inbound', 'les hago el sinpe ahorita')],
      [msg('inbound', 'Hice el pedido ORD-1234')],
      [msg('inbound', 'lo pedí en la página')],
    ]
    for (const h of notYet) assert.equal(noPaymentYet(h), false, JSON.stringify(h))
  })
  it('burst: an earlier "Para confirmar el pedido!?" no longer hands off the next delivery question (only with noPaymentYet)', () => {
    const base = { inboundText: '¿Cuánto duran en entregarlo a San Sebastián?', brandFacts: FACTS, shortcuts: SHORTCUTS, earlierCustomerTexts: ['Para confirmar el pedido!?'] }
    assert.equal(decideInbound({ ...base, noPaymentYet: true }).paymentClass, 'non_payment')
    assert.equal(decideInbound({ ...base, noPaymentYet: false }).paymentClass, 'payment_proof_or_risk')
    assert.equal(decideInbound(base).paymentClass, 'payment_proof_or_risk')
    // A photo message never gets the relaxation.
    assert.equal(decideInbound({ ...base, inboundText: 'me confirmás?', messageType: 'image', earlierCustomerTexts: [], noPaymentYet: true }).paymentClass, 'payment_proof_or_risk')
  })
  it('live and Probar both pass noPaymentYet into the decision', () => {
    const src = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.equal(src.match(/noPaymentYet: noPaymentYet\(/g)?.length, 2)
  })
})

describe('C3: per-night amounts derived from a known price are sourced', () => {
  const quote = [9900, 19800, 28500, 12900]
  it('price ÷ the nights / patches the reply states', () => {
    for (const text of [
      'El pack de 3 trae 90 noches y cuesta ₡28 500: sale a unos ₡317 por noche 🌙',
      'La bolsa de 30 parches cuesta ₡9 900, o sea ₡330 por noche.',
      'Con 90 noches, cada noche te sale en ₡317.',
      'El pack de 2 (60 noches) queda en ₡330 la noche.',
    ]) {
      const v = validateAgentOutput({ text, citedToolNames: [], quoteAmounts: quote })
      assert.equal(v.ok, true, `${text} → ${v.reasons}`)
    }
  })
  it('the count may come from the customer ("si trae 90 noches, ¿serían ₡317 por noche?")', () => {
    const v = validateAgentOutput({ text: 'Sí, exacto: unos ₡317 por noche 🌙', citedToolNames: [], quoteAmounts: quote, customerText: 'Pero si el pack cuesta ₡28 500 y trae 90 noches, serían como ₡317 por noche, cierto?' })
    assert.equal(v.ok, true, String(v.reasons))
  })
  it('still blocked: no count, not derived, per bag, or the same amount used as a price', () => {
    for (const [text, customer] of [
      ['Sale a ₡317 por noche', ''],
      ['El pack trae 80 noches, ₡317 por noche', ''],
      ['El pack de 3 bolsas sale a ₡9 500 por bolsa', ''],
      ['El pack de 3 trae 90 noches: ₡317 por noche. Total ₡317.', ''],
      ['Te lo dejo en ₡317', 'si trae 90 noches?'],
    ]) {
      const v = validateAgentOutput({ text, citedToolNames: [], quoteAmounts: quote, customerText: customer })
      assert.equal(v.ok, false, text)
      assert.ok(v.reasons.includes('unsourced_amount'), text)
    }
    assert.equal(unitDerivedAmount(317, '90 noches, ₡317 por noche', null, []), false)
  })
  it('the final policy (live path) passes it too', () => {
    const p = applyFinalOutputPolicy({ text: 'El pack de 3 trae 90 noches: unos ₡317 por noche 🌙', brandFacts: FACTS, quoteAmounts: quote, skipPurchaseSummary: true })
    assert.equal(p.ok, true, String(p.reasons))
  })
})

describe('C4: a real lock — one test run per business at a time', () => {
  function fakeDb(): LockDb & { row: { config: unknown } | null } {
    const state: { row: { config: unknown } | null } = { row: null }
    const tx = {
      tenantFeatureFlag: {
        upsert: async (a: { create: { config: unknown } }) => {
          if (!state.row) state.row = { config: a.create.config }
        },
        update: async (a: { data: { config: unknown } }) => {
          state.row = { config: a.data.config }
        },
      },
      $queryRaw: async () => [{ config: state.row?.config }],
    }
    let chain = Promise.resolve()
    return Object.assign(state, {
      // Serialised like FOR UPDATE: one transaction at a time.
      $transaction: <T>(fn: (t: typeof tx) => Promise<T>) => {
        const run = chain.then(() => fn(tx))
        chain = run.then(() => undefined, () => undefined)
        return run
      },
    }) as unknown as LockDb & { row: { config: unknown } | null }
  }
  it('a second run is refused whatever cap it asks (the old gap: a higher cap started anyway)', async () => {
    const db = fakeDb()
    const a = await acquireTestLock(db, { tenantId: 't1', label: 'exam', cap: 2_000_000 })
    await assert.rejects(acquireTestLock(db, { tenantId: 't1', label: 'shoppers', cap: 9_000_000 }), /Otra prueba está corriendo/)
    await assert.rejects(acquireTestLock(db, { tenantId: 't1', label: 'shadow', cap: 100 }), /Otra prueba está corriendo/)
    assert.equal(await releaseTestLock(db, { tenantId: 't1', token: 'not-mine' }), false)
    assert.equal(await releaseTestLock(db, { tenantId: 't1', token: a.token }), true)
    const b = await acquireTestLock(db, { tenantId: 't1', label: 'shoppers', cap: 9_000_000 })
    assert.notEqual(b.token, a.token)
  })
  it('two runs starting at the same moment: exactly one gets the lock', async () => {
    const db = fakeDb()
    const results = await Promise.allSettled([
      acquireTestLock(db, { tenantId: 't1', label: 'exam', cap: 1 }),
      acquireTestLock(db, { tenantId: 't1', label: 'shoppers', cap: 2 }),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  })
  it('a lock left by a dead run expires after the TTL', async () => {
    const db = fakeDb()
    const t0 = new Date('2026-10-18T04:00:00Z')
    await acquireTestLock(db, { tenantId: 't1', label: 'exam', cap: 1, now: t0 })
    await assert.rejects(acquireTestLock(db, { tenantId: 't1', label: 'exam', cap: 1, now: new Date(t0.getTime() + LOCK_TTL_MS - 1000) }))
    await acquireTestLock(db, { tenantId: 't1', label: 'exam', cap: 1, now: new Date(t0.getTime() + LOCK_TTL_MS + 1000) })
    assert.equal(activeLock({ released: true, token: 'x', expiresAt: '2999-01-01T00:00:00Z' }, t0), null)
    assert.equal(activeLock(null, t0), null)
    assert.equal(activeLock({ token: 'x', expiresAt: 'nonsense' }, t0), null)
  })
  it('test-session takes the lock before raising the cap and releases it in every exit path', () => {
    const src = readFileSync('scripts/agent-pack/test-session.ts', 'utf8')
    assert.ok(src.indexOf('acquireTestLock(') > 0 && src.indexOf('acquireTestLock(') < src.indexOf('testDailyTokenCap: Math.max('))
    assert.match(src, /\.finally\(\(\) => releaseLock\(\)\)/)
    assert.match(src, /\} finally \{\s+await releaseLock\(\)/)
    assert.match(src, /catch \(error\) \{\s+await releaseLock\(\)/)
    assert.match(src, /before >= input\.cap/)
  })
})

describe('C5: the exam replays history with realistic gaps', () => {
  const MIN = 60_000
  const step = Date.parse('2026-10-18T05:00:00Z')
  it('answered history sits outside the 10-min look-back; the unanswered tail is right before the step', () => {
    const lines = [
      { direction: 'inbound' as const, content: 'Para confirmar el pedido!?' },
      { direction: 'outbound' as const, content: 'Claro, ¿cuántas bolsas?' },
      { direction: 'inbound' as const, content: 'Una' },
      { direction: 'outbound' as const, content: 'Perfecto' },
      { direction: 'inbound' as const, content: 'y otra cosa' },
    ]
    const t = examHistoryTimes(lines, step)
    assert.equal(t.length, 5)
    assert.ok(t.every((x, i) => i === 0 || x > t[i - 1]))
    assert.ok(step - t[3] > 10 * MIN, 'the store last message is older than the look-back')
    assert.ok(step - t[0] > 10 * MIN)
    assert.equal(step - t[4], MIN)
  })
  it('real gaps from the bank win', () => {
    const t = examHistoryTimes([{ direction: 'inbound', content: 'a', agoMin: 600 }, { direction: 'outbound', content: 'b', agoMin: 2 }], step)
    assert.equal(step - t[0], 600 * MIN)
    assert.equal(step - t[1], 2 * MIN)
  })
  it('exam.ts uses it (no more 1-minute replay)', () => {
    const src = readFileSync('scripts/agent-pack/exam.ts', 'utf8')
    assert.match(src, /examHistoryTimes\(item\.history, stepAt\)/)
    assert.doesNotMatch(src, /\(item\.history\.length - i\) \* 60_000/)
    assert.match(readFileSync('scripts/agent-pack/exam-bank.ts', 'utf8'), /agoMin: Math\.max\(0\.1/)
  })
})

describe('C6: the delivery data list comes before the payment question', () => {
  const quoted = [msg('inbound', 'Hola, ¿precio?'), msg('outbound', 'La bolsa cuesta ₡9 900 y el envío ₡3 000.')]
  it('salesDataListFirst: at the close, before the list was asked and before the customer sent data', () => {
    const s = deriveSalesState({ history: quoted, inboundText: 'Me interesa, ¿cómo lo compro?', ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.equal(salesDataListFirst(s, quoted, 'Me interesa, ¿cómo lo compro?'), 'shipping')
    const p = deriveSalesState({ history: quoted, inboundText: 'Lo quiero, paso a retirarlo', ctx: CTX })
    assert.equal(salesDataListFirst(p, quoted, 'Lo quiero, paso a retirarlo'), 'pickup')
    const asked = [...quoted, msg('outbound', `Para coordinar el envío, pasame estos datos:\n${SHIPPING_DATA_LIST}`)]
    assert.equal(salesDataListFirst(deriveSalesState({ history: asked, inboundText: 'lo quiero', ctx: CTX }), asked, 'lo quiero'), null)
    const data = 'Lo quiero\nMaría Pérez\n8888-0000\nCartago'
    assert.equal(salesDataListFirst(deriveSalesState({ history: quoted, inboundText: data, ctx: CTX }), quoted, data), null)
    const method = [...quoted, msg('outbound', '¿Cómo preferís pagar?')]
    assert.equal(salesDataListFirst(deriveSalesState({ history: method, inboundText: 'sinpe', ctx: CTX }), method, 'sinpe'), null)
  })
  it('a closing reply that only asks the payment method gets the list first, the question in its own last message', () => {
    const out = dataListBeforePaymentQuestion('¡Claro! ¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta (en la web) y contra entrega dentro del GAM.', 'shipping')
    const parts = splitReplyParts(out)
    assert.equal(parts.length, 3)
    assert.equal(parts[0], '¡Claro!')
    assert.ok(parts[1].includes(SHIPPING_DATA_LIST))
    assert.match(parts[2], /^¿Cómo preferís pagar\? Tenemos SINPE/)
    const out2 = dataListBeforePaymentQuestion('Una bolsa cuesta ₡9 900 y el envío ₡3 000; total ₡12 900.\n\n¿Cómo preferís pagar?\n- SINPE\n- Tarjeta', 'pickup')
    const p2 = splitReplyParts(out2)
    assert.deepEqual([p2[0].startsWith('Una bolsa'), p2[1].includes(PICKUP_DATA_LIST), p2[2].startsWith('¿Cómo preferís pagar?')], [true, true, true])
  })
  it('a reply with the question BEFORE the list is reordered; a right one is left alone', () => {
    const wrong = `Total ₡12 900.\n\n¿Cómo preferís pagar? Tenemos SINPE y tarjeta.\n\nPara coordinar el envío, pasame estos datos:\n${SHIPPING_DATA_LIST}`
    const parts = splitReplyParts(dataListBeforePaymentQuestion(wrong, 'shipping'))
    assert.ok(parts[1].includes(SHIPPING_DATA_LIST))
    assert.match(parts[2], /^¿Cómo preferís pagar\?/)
    const right = `Total ₡12 900.\n\nPara coordinar el envío, pasame estos datos:\n${SHIPPING_DATA_LIST}\n\n¿Cómo preferís pagar? Tenemos SINPE y tarjeta.`
    assert.equal(dataListBeforePaymentQuestion(right, 'shipping'), right)
    assert.equal(dataListBeforePaymentQuestion('¿Te interesa el pack de 2?', 'shipping'), '¿Te interesa el pack de 2?')
    assert.equal(dataListBeforePaymentQuestion('Perfecto 🙌 [[PAGO_SINPE]]\n\n¿Cómo preferís pagar?', 'shipping'), 'Perfecto 🙌 [[PAGO_SINPE]]\n\n¿Cómo preferís pagar?')
  })
  it('applyFinalOutputPolicy orders it only when the sales flow asks (dataListFirst), and it stays sendable', () => {
    const text = '¡Claro! ¿Cómo preferís pagar? Tenemos SINPE Móvil, transferencia, tarjeta (en la web) y contra entrega dentro del GAM.'
    const p = applyFinalOutputPolicy({ text, brandFacts: FACTS, skipPurchaseSummary: true, shortenLongReply: true, paymentOptions: { dataListFirst: 'shipping' } })
    assert.equal(p.ok, true, String(p.reasons))
    assert.ok(p.reasons.includes('data_list_first'))
    assert.equal(p.parts.length, 3)
    assert.ok(p.parts[1].includes('Nombre completo'))
    assert.match(p.parts[2], /¿Cómo preferís pagar\?/)
    const off = applyFinalOutputPolicy({ text, brandFacts: FACTS, skipPurchaseSummary: true, shortenLongReply: true })
    assert.equal(off.text, text)
  })
  it('the close instruction tells the model the order (list first, payment question last)', () => {
    const s = deriveSalesState({ history: quoted, inboundText: 'lo quiero', ctx: CTX })
    assert.match(formatSalesTurnBlock(CTX, s), /AL FINAL, en su propio mensaje, preguntá cómo prefiere pagar con la pregunta de pago de abajo, nunca antes de la lista de datos/)
    assert.match(readFileSync('src/lib/soft-ai/agent-turn-inputs.ts', 'utf8'), /dataListFirst: salesState \? salesDataListFirst\(salesState, input\.history, input\.inboundText\) : null/)
  })
})

describe('Pura Sonrisa exam (2026-10-18) cases', () => {
  const PURA: SalesContext = {
    ...CTX,
    catalog: [
      { name: 'Pura Sonrisa  Menta ', price: 11900, stockLabel: 'disponible' },
      { name: 'Pura Sonrisa Sandia ', price: 11900, stockLabel: 'disponible' },
      { name: 'Pura Sonrisa   Blue Raspberry.', price: 11900, stockLabel: 'disponible' },
      { name: 'Pura Sonrisa  Fresa ', price: 11900, stockLabel: 'disponible' },
    ],
    bundles: [{ name: 'Combo 2 cajas', price: 19900, shippingIncluded: true }],
    freeShippingOver: 19900,
  }
  it('1. "Quiero el combo de menta y fresa con envío a San José" → data list before "¿Cómo preferís pagar?"', () => {
    const inbound = 'Quiero el combo de menta y fresa con envío a San José'
    const s = deriveSalesState({ history: [], inboundText: inbound, ctx: PURA })
    assert.equal(salesDataListFirst(s, [], inbound), 'shipping')
    const p = applyFinalOutputPolicy({
      text: '¡Claro! El Combo 2 cajas sale ₡19 900 en total, ya con el envío.\n\n¿Cómo preferís pagar? Tenemos SINPE Móvil y tarjeta.',
      brandFacts: FACTS,
      quoteAmounts: [19900],
      skipPurchaseSummary: true,
      shortenLongReply: true,
      paymentOptions: { dataListFirst: 'shipping' },
    })
    assert.ok(p.parts[1].includes('Nombre completo'), p.parts.join(' | '))
    assert.match(p.parts[2], /^¿Cómo preferís pagar\?/)
  })
  it('2. "¿cómo sería el envío y el pago?" / "y el pago como seria" are questions, not claims', () => {
    assert.equal(classifyPaymentText('¿cómo sería el envío y el pago?'), 'payment_info_safe')
    assert.equal(classifyPaymentText('y el pago como seria'), 'payment_info_safe')
    for (const t of ['¿cómo sería el envío y el pago?', 'y el pago como seria', 'Hola, ¿cómo sería el pago y el envío?', '¿y el pago cómo es?', 'Buenas, el envío y el pago cómo sería?']) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['¿cómo sería el pago del resto?', 'y el pago como seria, ya pagué', '¿cómo sería el pago? ya les hice el sinpe', 'el pago cómo quedó?']) assert.equal(isHowPayShipQuestion(t), false, t)
    for (const t of ['¿cómo sería el pago? ya les hice el sinpe', 'y el pago como seria, ya pagué', 'el pago cómo quedó?']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('3. the shared brand prefix ("Pura Sonrisa") is not "another product"; the flavour still is', async () => {
    const { salesFreeShippingRule } = await import('@/lib/soft-ai/sales-state')
    const rule = salesFreeShippingRule(PURA)!
    assert.deepEqual(rule.otherNames, ['menta', 'sandia', 'blue', 'fresa'])
    const ok = validateAgentOutput({ text: 'El Combo 2 cajas de Pura Sonrisa sale ₡19 900 con envío incluido.', citedToolNames: [], quoteAmounts: [19900], freeShippingRule: rule })
    assert.equal(ok.ok, true, String(ok.reasons))
    const flavour = validateAgentOutput({ text: 'La Menta sale ₡19 900 con envío incluido.', citedToolNames: [], quoteAmounts: [19900], freeShippingRule: rule })
    assert.equal(flavour.ok, false)
    // PatchHouse-like names (different first words) keep their old first-word rule.
    const ph = salesFreeShippingRule({ ...CTX, catalog: [{ name: 'GLP-1', price: 15900, stockLabel: 'x' }, { name: 'Focus', price: 9900, stockLabel: 'x' }] })!
    assert.deepEqual(ph.otherNames, ['glp', 'focus'])
  })
  it('4. the store\'s own threshold rule may be said ("envío gratis desde 2 cajas / desde ₡19 900")', async () => {
    const { salesFreeShippingRule, salesAllowedAmounts } = await import('@/lib/soft-ai/sales-state')
    const rule = salesFreeShippingRule(PURA)!
    assert.equal(rule.freeOver, 19900)
    // INT-84: the threshold is never an allowed price (19 900 is allowed here only because it is the combo price).
    assert.ok(!salesAllowedAmounts({ ...PURA, bundles: [] }).includes(19900))
    for (const text of [
      'Tenemos envío gratis desde 2 cajas 🚚',
      'El envío es gratis en compras desde ₡19 900.',
      'Envío gratis a todo el país a partir de dos cajas.',
      'Con 1 caja el envío cuesta ₡3 000. Envío gratis llevando 2 cajas o más.',
    ]) {
      const v = validateAgentOutput({ text, citedToolNames: [], quoteAmounts: [...salesAllowedAmounts(PURA)], freeShippingRule: rule })
      assert.equal(v.ok, true, `${text} → ${v.reasons}`)
    }
    for (const text of [
      'Envío gratis desde 1 caja',
      'Envío gratis desde ₡15 000',
      'Tu pedido califica: envío gratis desde 2 cajas',
      'Hoy te damos envío gratis desde 2 cajas',
      'Envío gratis en todos los pedidos',
      'Envío gratis desde 2 cajas. La Menta también trae envío gratis.',
    ]) {
      const v = validateAgentOutput({ text, citedToolNames: [], quoteAmounts: [...salesAllowedAmounts(PURA), 15000], freeShippingRule: rule })
      assert.equal(v.ok, false, text)
    }
    // No threshold configured: the rule is not there at all (old behaviour).
    assert.equal(salesFreeShippingRule({ ...PURA, bundles: [], freeShippingOver: null }), null)
    assert.match(readFileSync('src/lib/soft-ai/agent-sales-context.ts', 'utf8'), /freeShippingOver: input\.brandFacts\.shipping\?\.ea\?\.enabled !== false/)
  })
})

describe('Pura Sonrisa P2 keeps INT-84: the threshold amount is only valid inside the threshold rule', () => {
  it('threshold ₡25 000 that is no product price: rule OK, as a price blocked, count checked against the cheapest item', async () => {
    const { salesFreeShippingRule, salesAllowedAmounts } = await import('@/lib/soft-ai/sales-state')
    const ctx: SalesContext = {
      ...CTX,
      catalog: [
        { name: 'Pura Sonrisa Menta', price: 11900, stockLabel: 'x' },
        { name: 'Pura Sonrisa Fresa', price: 11900, stockLabel: 'x' },
      ],
      bundles: [],
      freeShippingOver: 25000,
    }
    const rule = salesFreeShippingRule(ctx)!
    const quote = salesAllowedAmounts(ctx)
    assert.ok(!quote.includes(25000))
    const check = (text: string) => validateAgentOutput({ text, citedToolNames: [], quoteAmounts: quote, freeShippingRule: rule })
    for (const t of ['Envío gratis en compras desde ₡25 000 🚚', 'Tenemos envío gratis a partir de 3 cajas.']) assert.equal(check(t).ok, true, `${t} → ${check(t).reasons}`)
    for (const t of [
      'Los 3 en ₡25 000',
      'Te quedan en ₡25 000 con envío gratis',
      'Envío gratis desde ₡25 000. Los 3 te quedan en ₡25 000.',
      'Envío gratis a partir de 2 cajas.',
      'Envío gratis desde ₡20 000',
    ]) assert.equal(check(t).ok, false, t)
  })
})
