/**
 * Review 2026-11-04 (live PRs #161–#167): real payment claims must always reach a person; sales questions that only
 * carry a payment word are answered by the agent. Phrases are from the live week (Oct 28 – Nov 4) and the review.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/bot-fixes-2026-11-04.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText, isSalesPayQuestion, maskFutureReceiptPromise } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { newestOpenRoundIds, planFollowUpCampaignsOnEnable, patchRawFollowUpConfigEnable, restoreRawFollowUpCampaignFields } from '@/lib/soft-ai/deepsleep-conversion-pack'

const CLAIMS = [
  // A claim next to a sales shape: the shape used to win anywhere in the message.
  'Ya realicé el pago, el envío viene pago?',
  'ya di el adelanto, el envío viene pago?',
  'ya hize el pago. retirar y pagar ahí?',
  'ya pagé, se paga en la página el envío?',
  'Hecho. viene pago el envío?',
  'Le mandé, retiro y pago ahí',
  '✅ el envío viene pago',
  'Ya hice el sinpe, a qué número le pago el resto?',
  // A receipt promise is a claim unless the same bubble asks for the number.
  '¿Te paso el comprobante?',
  'Listo, le paso el comprobante por acá?',
  'Ya está, ¿te paso el comprobante?',
  'te paso el comprobante de la transferencia?',
  // "confirmar mi dirección" no longer hides another confirm cue.
  'Hola, me confirman que entró? y quiero confirmar mi dirección',
  'me confirman si lo vieron? para confirmar el retiro',
  // Live claims.
  'Listo el pago',
  'Hola ForgeCR, te envío el comprobante SINPE del pedido ORD-1793229953698-5392 por ₡14.900.',
  'Ya pagué',
  'ya pagé',
  'ya le pagé',
  'Ya Pagé',
  // Verifier r1: a part still owed / an earlier part / a payment act without a noun.
  'a qué sinpe pago el resto?',
  'a qué sinpe pago lo que falta?',
  'a qué sinpe pago lo pendiente?',
  'a qué sinpe pago mi parte?',
  'sin pago extra por lo que falta?',
  'el envío viene pago o lo debo?',
  'acabo de mandar la foto, hay contra entrega',
  'te paso el comprobante del adelanto, a qué sinpe pago el resto?',
  'a qué sinpe pago? le paso el comprobante del primero',
  'ahí te paso el comprobante, a qué número pago el envío?',
  'te paso el comprobante, cuál es el número para el resto?',
  'le paso el comprobante, me pasás la cuenta para el resto?',
  'ya lo tengo pago, se puede pagar contra entrega?',
  'Ya hice el sinpe contra entrega',
  // SecureDog INT-246: a payment statement next to a COD question.
  '¿Hay contra entrega? Se lo dio al mensajero',
  'aceptan contra entrega? se lo entrego mi mamá al mensajero',
  'hacen contra entrega? mi hermana lo arreglo todo',
  'tienen contra entrega? mi mamá lo resolvio con el mensajero',
  'hay contra entrega? todo arreglado con el mensajero',
]

const SALES = [
  'Ah ok ok…\n\nPero por eso… si yo pido el 3XL y me queda pequeño o así… si se hace el cambio normal? Sin ningún tipo de problema o pago extra?',
  'Bueno y se te hace el pago en el sitio?',
  'Entonces en ese precio por dos ya viene pago el envío de correos? Muchas gracias',
  'Es solo con envío? \nNo las puedo pasar a retirar a alguna parte y ahí pagar?',
  'Hola quiero comprar 1 solo, cuanto sale con envío a Limón y a qué si pe pago',
  'Muchas gracias solo estoy esperando un pago para poder realizar la compra',
  'Si me interesa se puede pagar contra entrega',
  'Preferiría pagarlo de una vez con SINPE, ¿a qué número sería, y le paso el comprobante por acá?',
  'Perfecto 👌🏽 \nVoy a confirmar mi peso y les aviso',
  'viene pago el envío?',
  'hay manera de retirar y pagar ahi mismo',
  // Live 2026-11-04 replay: SINPE to the courier on delivery is the contra-entrega choice.
  'Sinpe móvil contra entrega',
]

describe('payment classifier — review 2026-11-04', () => {
  it('every real claim goes to a person', () => {
    for (const t of CLAIMS) assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })
  it('sales questions with a payment word are answered by the model (not the canned method list)', () => {
    for (const t of SALES) assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    for (const t of ['Bueno y se te hace el pago en el sitio?', 'Muchas gracias solo estoy esperando un pago para poder realizar la compra']) {
      assert.equal(classifyPaymentText(t), 'non_payment', t)
    }
  })
  it('the sales allowlist needs everything outside the shape to be clean', () => {
    assert.equal(isSalesPayQuestion('viene pago el envío?'), true)
    assert.equal(isSalesPayQuestion('Ya realicé el pago, el envío viene pago?'), false)
    assert.equal(isSalesPayQuestion('Listo, retirar y pagar ahí?'), false)
    assert.equal(isSalesPayQuestion('Ya pagué'), false)
  })
  it('a receipt promise is masked only next to a number ask', () => {
    assert.equal(maskFutureReceiptPromise('¿Te paso el comprobante?'), '¿Te paso el comprobante?')
    assert.notEqual(maskFutureReceiptPromise('¿a qué número sería, y le paso el comprobante por acá?'), '¿a qué número sería, y le paso el comprobante por acá?')
    assert.equal(maskFutureReceiptPromise('Ya hice el sinpe, ¿a qué número? y le paso el comprobante'), 'Ya hice el sinpe, ¿a qué número? y le paso el comprobante')
  })
  it('regex stays fast on 4 KB inputs', () => {
    for (const filler of ['a ', 'pago ', 'ya ', 'viene pago el envío ', '¿te paso el comprobante? ']) {
      const t = filler.repeat(Math.ceil(4096 / filler.length)).slice(0, 4096)
      const t0 = Date.now()
      classifyPaymentText(t)
      assert.ok(Date.now() - t0 < 1500, `slow on "${filler}"`)
    }
  })
})

describe('typed claim + voice note in one burst', () => {
  it('hands off as a payment, not "¿Me contás por escrito?"', () => {
    const facts = { schemaVersion: 1 } as never
    const d = decideInbound({ inboundText: '[audio]', messageType: 'audio', earlierCustomerTexts: ['Ya pagué'], brandFacts: facts, shortcuts: [] } as never)
    assert.equal(d.escalate, true)
    assert.notEqual(d.shortcutKey, 'sys_media_ask')
    // A voice note alone still gets the type-it reply.
    const alone = decideInbound({ inboundText: '[audio]', messageType: 'audio', brandFacts: facts, shortcuts: [] } as never)
    assert.equal(alone.shortcutKey, 'sys_media_ask')
  })
})

describe('follow-up enable never restarts a stopped round', () => {
  const agent = 'forge'
  const campaigns = [
    { id: 'old', agentId: agent, active: false, createdAt: '2026-11-01T00:00:00Z', until: '2026-11-03T00:00:00Z', stoppedAt: '2026-11-03T00:00:00Z' },
    { id: 'byhand', agentId: agent, active: false, createdAt: '2026-11-02T00:00:00Z', until: '2099-01-01T00:00:00Z', stoppedAt: '2026-11-02T05:00:00Z' },
    { id: 'live', agentId: agent, active: true, createdAt: '2026-11-03T00:00:00Z', until: '2026-11-05T00:00:00Z' },
    { id: 'other', agentId: 'ph', active: false, createdAt: '2026-11-03T00:00:00Z', until: '2026-11-05T00:00:00Z' },
  ]
  it('patches only the newest open round of the agent', () => {
    assert.deepEqual([...newestOpenRoundIds(campaigns, new Set([agent]))], ['live'])
    const planned = planFollowUpCampaignsOnEnable(campaigns, { enableAgentIds: new Set([agent]), stageTextsFor: () => ({ B: { quoted: 'x' } }) })
    assert.equal(planned.find((c) => c.id === 'byhand')!.active, false)
    assert.equal(planned.find((c) => c.id === 'old')!.active, false)
    assert.deepEqual((planned.find((c) => c.id === 'live') as { stageTexts?: unknown }).stageTexts, { B: { quoted: 'x' } })
    const raw = patchRawFollowUpConfigEnable({ campaigns }, { enableAgentIds: new Set([agent]), stageTextsFor: () => ({}) })
    assert.deepEqual(raw.patchedIds, ['live'])
  })
  it('a backup with stageTexts null removes the texts on revert', () => {
    const live = { campaigns: [{ id: 'live', agentId: agent, active: true, stageTexts: { B: { quoted: 'x' } } }] }
    const before = JSON.parse(JSON.stringify({ live: { active: true, stageTexts: null } }))
    const restored = restoreRawFollowUpCampaignFields(live, ['live'], before) as { campaigns: Array<Record<string, unknown>> }
    assert.equal('stageTexts' in restored.campaigns[0], false)
  })
})

describe('card by team (Rafael 2026-11-04: a person makes the Tilopay link)', async () => {
  const { parseBrandFacts } = await import('@/lib/soft-ai/brand-facts')
  const { fillPaymentToken, CARD_BY_TEAM_LINE } = await import('@/lib/soft-ai/payment-guard')
  const { planModelTurnDelivery } = await import('@/lib/soft-ai/agent-turn-outcome')
  const facts = parseBrandFacts({
    schemaVersion: 1,
    website: 'https://forge.shopping',
    payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' } },
  })
  it('the card token never carries the website link when on', () => {
    const on = fillPaymentToken('Perfecto 🙌 [[PAGO_TARJETA]]', facts, { cardByTeam: true })
    assert.match(on.text, /Te preparo el link de pago/)
    assert.doesNotMatch(on.text, /forge\.shopping/)
    assert.deepEqual(on.methods, ['tarjeta'])
    const off = fillPaymentToken('Perfecto 🙌 [[PAGO_TARJETA]]', facts, {})
    assert.match(off.text, /forge\.shopping/)
  })
  it('choosing card hands the chat to a person; off keeps the old reply', () => {
    const base = { inboundText: 'Tarjeta', messageType: 'text', brandFacts: facts, shortcuts: [], awaitingPaymentMethod: true }
    const on = decideInbound({ ...base, cardByTeam: true } as never)
    assert.equal(on.escalate, true)
    assert.match(on.text || '', /Te preparo el link de pago/)
    const off = decideInbound(base as never)
    assert.doesNotMatch(off.text || '', /Te preparo el link/)
  })
  it('a model reply that filled the card line is a true hand-off (payment_details)', () => {
    const plan = planModelTurnDelivery({ text: `Perfecto 🙌\n${CARD_BY_TEAM_LINE}`, textOk: true, llmHandoff: null, cardByTeam: true })
    assert.deepEqual(plan.handoff, { kind: 'handoff', reason: 'payment_details' })
    assert.match(plan.text, /Te preparo el link/)
  })
})

describe('verifier r2 — card label, link ask, soft-release gate', async () => {
  const { parseBrandFacts } = await import('@/lib/soft-ai/brand-facts')
  const { paymentMethodsQuestion } = await import('@/lib/soft-ai/payment-guard')
  const facts = parseBrandFacts({
    schemaVersion: 1,
    website: 'https://forge.shopping',
    payment: { shareWithCustomers: true, methods: ['sinpe', 'tarjeta', 'contra_entrega'], sinpe: { number: '62019914', holderName: 'Rafael García' } },
  })
  it('card by team: no "(en la web)" in the method list; a link ask hands off', () => {
    assert.doesNotMatch(paymentMethodsQuestion(facts, true), /en la web/)
    assert.match(paymentMethodsQuestion(facts, false), /en la web/)
    const d = decideInbound({ inboundText: '¿Me pasás el link de pago?', messageType: 'text', brandFacts: facts, shortcuts: [], cardByTeam: true } as never)
    assert.equal(d.escalate, true)
    assert.match(d.text || '', /Te preparo el link de pago/)
  })
  it('the gate re-reads the flag, declines on a newer customer message and on a repeat', () => {
    const src = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.match(src, /return decline\('flag_off'\)/)
    assert.match(src, /return decline\('customer_wrote_again'\)/)
    assert.match(src, /if \(input\.payload\.softRelease && repeat\.dropped\.length\) \{/)
    const sweep = readFileSync('src/lib/soft-ai/soft-release.ts', 'utf8')
    assert.match(sweep, /!== 'reaction'/)
  })
})
