/**
 * Burst = one reply (PatchHouse Instagram, 2026-10-17). Pure functions + source asserts (no DB, no model calls).
 * 1) Two bubbles within seconds get ONE turn: the newest job answers the burst, older jobs are superseded.
 * 2) Media + text in the same burst: the text is answered, a person still looks at the media (review).
 * The behaviour tests run decideBurstTurn — the exact function live and Probar call.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BURST_LOAD_MAX,
  BURST_MAX_AGE_MS,
  BURST_YIELD_MAX_AGE_MS,
  burstHasLaterBubble,
  burstOutgrowsWindow,
  burstOptOutIn,
  burstOtherTexts,
  burstReviewFor,
  burstReviewIn,
  burstTraceStep,
  isCourtesyOnly,
  planBurstInbound,
  resolveBurstDecision,
  shouldYieldToNewerBurst,
  unansweredBurst,
  type BurstMessage,
} from '@/lib/soft-ai/inbound-burst'
import { decideBurstTurn } from '@/lib/soft-ai/burst-decision'
import { BURST_HOLD_SECONDS, BURST_SETTLE_MS, NEWEST_BURST_JOB_ORDER } from '@/lib/soft-ai/automation-queue'
import { HISTORY_WINDOW_MAX } from '@/lib/soft-ai/agent-types'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import type { TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'
import { parseBrandFacts, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import { deriveSalesState, type SalesContext } from '@/lib/soft-ai/sales-state'

const read = (p: string) => readFileSync(p, 'utf8')
const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({
  ...row,
  id: `s-${index}`,
  isActive: true,
  sortOrder: index,
}))
/** A store that does not share payment data by chat (the team sends it). */
const facts = parseBrandFacts({ schemaVersion: 1 })
/** A store that shares SINPE + tarjeta in chat (PatchHouse-like fixture). */
const SHARED: BrandFacts = parseBrandFacts({
  website: 'https://tienda.example.cr',
  payment: {
    shareWithCustomers: true,
    methods: ['sinpe', 'tarjeta'],
    sinpe: { number: '62019914', holderName: 'Rafael García' },
    cardUrl: 'https://pagos.example.cr/p',
  },
})
const T0 = new Date('2026-10-17T15:00:00.000Z').getTime()
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
let seq = 0
type Msg = BurstMessage & { id: string; content: string; sentAt: string }
const inbound = (content: string, s: number, messageType = 'text'): Msg => ({ id: `m${++seq}`, direction: 'inbound', content, messageType, sentAt: at(s) })
const outbound = (content: string, s: number): Msg => ({ id: `m${++seq}`, direction: 'outbound', content, messageType: 'text', sentAt: at(s) })
const PAYMENT_DETAILS_SENT = (s = -120) => outbound('Perfecto 🙌 Hacé el SINPE al 6201-9914 y me mandás el comprobante por aquí', s)

/** Live / Probar: plan the burst, then decideBurstTurn (no DB). */
function run(trigger: { content: string; messageType?: string; s: number }, history: Msg[], brandFacts: BrandFacts = facts, extra: RuntimeShortcut[] = []) {
  const t = { content: trigger.content, messageType: trigger.messageType || 'text', sentAt: at(trigger.s) }
  const burstEarlier = unansweredBurst(history, t)
  const burst = planBurstInbound({ trigger: t, earlier: burstEarlier, awaitingReceipt: () => false })
  const out = decideBurstTurn({
    burst,
    burstEarlier,
    trigger: t,
    history,
    mediaSalesContext: null,
    earlierCustomerTexts: [],
    decisionBase: { brandFacts, shortcuts: [...shortcuts, ...extra], awaitingPaymentMethod: false },
  })
  return { burst, ...out }
}

/** An owner's saved reply sent as written ("precio" → the price list). */
const PRICE_REPLY: RuntimeShortcut = {
  id: 'owner-precio',
  key: 'owner_precio',
  title: 'Precios',
  kind: 'playbook',
  intents: ['other'] as RuntimeShortcut['intents'],
  keywords: ['precio'],
  body: 'Los parches cuestan ₡12.000 cada caja 😊',
  deliveryMode: 'verbatim',
  isActive: true,
  sortOrder: 999,
}

/** Receipt variant: the burst plan's receipt check reads the history like live (mediaAwaitingReceipt). */
function runAwaitingReceipt(trigger: { content: string; messageType?: string; s: number }, burstBubbles: Msg[], paymentSentS = -120) {
  const history = [PAYMENT_DETAILS_SENT(paymentSentS), ...burstBubbles]
  const t = { content: trigger.content, messageType: trigger.messageType || 'text', sentAt: at(trigger.s) }
  const burstEarlier = unansweredBurst(history, t)
  const burst = planBurstInbound({ trigger: t, earlier: burstEarlier, awaitingReceipt: (type) => type === 'image' || type === 'document' })
  const out = decideBurstTurn({
    burst,
    burstEarlier,
    trigger: t,
    history,
    mediaSalesContext: null,
    earlierCustomerTexts: [],
    decisionBase: { brandFacts: facts, shortcuts, awaitingPaymentMethod: false },
  })
  return { burst, ...out }
}

describe('burst = one reply · queue coalescing (source)', () => {
  it('a running job yields to a newer queued bubble only while its trigger is fresh', () => {
    const trigger = new Date(T0)
    assert.equal(shouldYieldToNewerBurst({ newerPending: true, triggerSentAt: trigger, now: T0 + 5_000 }), true)
    assert.equal(shouldYieldToNewerBurst({ newerPending: false, triggerSentAt: trigger, now: T0 + 5_000 }), false)
    assert.equal(shouldYieldToNewerBurst({ newerPending: true, triggerSentAt: trigger, now: T0 + BURST_YIELD_MAX_AGE_MS }), false)
  })

  it('agent-layer inbound jobs settle before they are claimable; legacy keeps its immediate dispatch', () => {
    assert.ok(BURST_SETTLE_MS >= 2_000 && BURST_SETTLE_MS <= 5_000)
    assert.ok(BURST_HOLD_SECONDS * 1000 > BURST_SETTLE_MS)
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    assert.match(hook, /const settleMs = \(await shouldUseChatAgentLayerV1\(args\.tenantId\)\) \? BURST_SETTLE_MS : 0/)
    assert.match(hook, /\.\.\.\(settleMs \? \{ availableAt: new Date\(Date\.now\(\) \+ settleMs\) \} : \{\}\)/)
    assert.match(hook, /return \{ jobId: row\.id, duplicate: row\.duplicate, settleMs \}/)
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    assert.match(queue, /\.\.\.\(input\.availableAt \? \{ availableAt: input\.availableAt \} : \{\}\)/)
    assert.match(queue, /newer\."availableAt" <= CURRENT_TIMESTAMP \+ \$\{Prisma\.raw\(`INTERVAL '\$\{BURST_HOLD_SECONDS\} seconds'`\)\}/)
    assert.match(queue, /inflight\."status" = 'processing'/)
    assert.match(queue, /await supersedeOlderJobs\(row\.conversationId, row\.id\)/)
    const fn = queue.slice(queue.indexOf('export async function newerBurstJobPending'), queue.indexOf('async function supersedeOlderJobs'))
    assert.match(fn, /tenantId: row\.tenantId,\s+conversationId: row\.conversationId/)
    assert.match(fn, /kind: SOFT_AI_JOB_KIND/)
    assert.match(fn, /status: \{ in: \['pending', 'retry'\] \}/)
    // Live 2026-10-18 duplicate reply: a newer job already claimed (inside its lease) also takes the burst; an expired
    // lease never does.
    assert.match(fn, /\{ status: 'processing', leaseExpiresAt: \{ gt: new Date\(\) \} \}/)
    assert.match(fn, /createdAt: \{ gt: self\.createdAt \}/)
  })

  it('a bubble with no content never gets a job', () => {
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    const enqueue = hook.slice(hook.indexOf('export async function enqueueSoftAiAfterInbound'))
    assert.ok(enqueue.indexOf("if (!(args.content || '').trim()) return { skippedReason: 'empty_content' }") > 0)
    assert.ok(enqueue.indexOf('empty_content') < enqueue.indexOf('persistJob('))
  })

  it('the webhook dispatches after each job\'s own settle; a superseded job always hands over', () => {
    const webhook = read('src/app/api/chat/webhook/route.ts')
    assert.match(webhook, /processJobAfterSettle\(jobId, softAiSettleMs\.get\(jobId\) \?\? 0\)/)
    assert.doesNotMatch(webhook, /void processJobById\(jobId\)/)
    const proc = read('src/lib/soft-ai/automation-processor.ts')
    assert.match(proc, /setTimeout\(\(\) => \{\s+void processJobById\(id\)\.catch/)
    assert.match(proc, /\}, settleMs > 0 \? settleMs \+ 250 : 0\)/)
    assert.match(proc, /if \(kick \|\| superseded\) void kickNextConversationJob\(row\)/)
  })

  it('the agent turn yields before the model, after loading history and right before each send — never a hand-off, a reclaim, or twice per burst', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    const pre = live.indexOf('if (await yieldsToNewerBurst(row, trigger.sentAt)) {')
    assert.ok(pre > live.indexOf('runClaimGates(') && pre < live.indexOf('runPreModelGates('))
    const later = live.indexOf('if (burstHasLaterBubble(burstEarlier, trigger) && (await yieldsToNewerBurst(row, trigger.sentAt))) {')
    assert.ok(later > live.indexOf('const burstEarlier = unansweredBurst(') && later < live.indexOf('const burst = planBurstInbound('))
    const sends = [...live.matchAll(/return finishDeliveryOrSuggest\(\{/g)].map((m) => m.index!)
    const handledYield = live.indexOf("if (await yieldsToNewerBurst(row, trigger.sentAt, plan.handoff, 'pre_send')) return markTurnSuperseded(row, turn.id)")
    const modelYield = live.indexOf("if (await yieldsToNewerBurst(row, trigger.sentAt, modelPlan.handoff, 'pre_send')) return markTurnSuperseded(row, turn.id)")
    assert.ok(handledYield > sends[0] && handledYield < sends[1])
    assert.ok(modelYield > sends[1] && modelYield < sends[2])
    const helper = turn.slice(turn.indexOf('async function yieldsToNewerBurst'), turn.indexOf('async function markTurnSuperseded'))
    assert.match(helper, /if \(plannedHandoff\?\.kind === 'handoff' \|\| row\.attempts > 1\) return false/)
    assert.match(helper, /if \(stage === 'pre_send' && \(await recentlyDroppedGeneratedReply\(row\)\)\) return false/)
    assert.match(helper, /skipReason: 'superseded',\s+outputText: \{ not: null \},/)
    assert.match(turn, /where: \{ id: turnId, tenantId: row\.tenantId, status: 'generated' \},\s+data: \{ status: 'skipped', skipReason: 'superseded'/)
    assert.doesNotMatch(live, /deliveryKey: `/)
  })

  it('every live model run counts toward the daily token cap (superseded, duplicate_reply, …)', () => {
    const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
    const fn = gates.slice(gates.indexOf('export async function loadDailyBilledTokens'), gates.indexOf('export async function loadDailyTestTokens'))
    assert.doesNotMatch(fn, /status: \{ notIn: \['skipped'\] \}/)
    assert.doesNotMatch(fn, /skipReason/)
    assert.match(fn, /mode: \{ not: 'test' \}/)
  })
})

describe('burst = one reply · which bubbles', () => {
  it('stops at the store\'s last reply wherever it sits; includes bubbles sent after the trigger', () => {
    const history = [inbound('antes', -300), outbound('respuesta', -200), inbound('viejo', -190), inbound('uno', -5), inbound('después', 5)]
    assert.deepEqual(unansweredBurst(history).map((m) => m.content), ['viejo', 'uno', 'después'])
    // Verifier r1 #3: the store answered after this trigger was sent → that question is not answered again.
    const answered = [inbound('¿Cuánto cuesta?', 0), outbound('Cuesta ₡12.000', 4)]
    assert.deepEqual(unansweredBurst(answered), [])
    const again = run({ content: '[image]', messageType: 'image', s: 2 }, answered)
    assert.equal(again.burst.reason, 'single')
    assert.equal(again.decision.shortcutKey, 'sys_media_ask')
    assert.equal(burstHasLaterBubble([inbound('ya te pagué', 3)], { sentAt: at(1) }), true)
    assert.equal(burstHasLaterBubble([inbound('hola', 0)], { sentAt: at(1) }), false)
    assert.equal(burstHasLaterBubble([inbound('hola', 0)], { sentAt: 'no-date' }), false)
  })

  it('IG ad burst (share + "Quiero más información") and "Top" + "GLP1" → one model answer', () => {
    const ig = run({ content: '¡Hola! Quiero más información.', s: 1 }, [outbound('¡Hola! Soy Sofi 😊', -3600), inbound('[ig_post] https://instagram.com/p/x', 0)])
    assert.equal(ig.burst.reason, 'single')
    assert.equal(ig.decision.handled, false)
    const top = run({ content: 'GLP1', s: 4 }, [outbound('¡Hola! ¿En qué te ayudo?', -60), inbound('Top', 0)])
    assert.equal(top.burst.inboundText, 'GLP1')
    assert.equal(top.decision.handled, false)
  })

  it('placeholders are the webhook\'s own tokens only; file names are not text', () => {
    const earlier = [inbound('[share]', 0), inbound('IMG-20261017.pdf', 1, 'document'), inbound('[STOP]', 2), inbound('[urgente]', 3)]
    assert.deepEqual(burstOtherTexts(earlier, { inboundText: 'x' }).map((o) => o.text), ['[STOP]', '[urgente]'])
  })

  it('courtesy-only bubbles ask nothing', () => {
    for (const t of ['Hola', '¡Buenas tardes!', 'gracias 🙏', 'ok', 'Pura vida', 'hola, buenas', 'Buen día', 'Bueno', 'Claro', 'Mil gracias', 'Ah ok', 'jaja', 'Hola, ¿cómo estás?']) {
      assert.equal(isCourtesyOnly(t), true, t)
    }
    assert.deepEqual(burstOtherTexts([inbound('[fallback]', 0)], { inboundText: 'x' }), [])
    for (const t of ['Hola, ¿tienen envíos?', 'Quiero 2', '¿precio?', '']) assert.equal(isCourtesyOnly(t), false, t)
  })
})

describe('burst = one reply · hand-offs and questions in any bubble', () => {
  it('Verifier r1 #1: "Quiero hablar con una persona" + "por favor" still goes to a person', () => {
    const { decision } = run({ content: 'por favor', s: 2 }, [inbound('Quiero hablar con una persona', 0)])
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
    assert.deepEqual(decision.handoff, { kind: 'handoff', reason: 'human_request' })
  })

  it('SecureDog r3 #1: "STOP" + "por favor" → hand-off AND the later waiting ack stays silent', () => {
    const { decision, optOut } = run({ content: 'por favor', s: 2 }, [inbound('STOP', 0)])
    assert.equal(decision.handoff?.kind, 'handoff')
    assert.equal(optOut, true)
    assert.equal(burstOptOutIn(decision.decisionTrace), true)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(turn, /isOptOutText\(input\.payload\.content\) \|\|\s+burstOptOutIn\(lastTurn\.decisionTrace\) \|\|\s+inboundSince\.some\(\(m\) => isOptOutText\(m\.content\)\),/)
    // SecureDog R3: every customer message since the hand-off is read (the STOP bubble's job may have been superseded).
    assert.match(turn, /direction: 'inbound', sentAt: \{ gt: since \} \},\s+select: \{ content: true \},\s+take: 50,/)
    // SecureDog R1: only a message sent no earlier than this trigger can take the burst.
    assert.match(read('src/lib/soft-ai/automation-queue.ts'), /\.\.\.\(triggerSentAt \? \{ message: \{ sentAt: \{ gte: triggerSentAt \} \} \} : \{\}\)/)
    assert.match(turn, /newerPending: await newerBurstJobPending\(row, triggerSentAt\)/)
    // No opt-out anywhere → nothing recorded.
    assert.equal(run({ content: '¿precio?', s: 2 }, [inbound('hola', 0)]).optOut, false)
  })

  it('Verifier r2 #1 / MEDIA-14: a photo captioned "Quiero hablar con una persona" + "hola?" still goes to a person', () => {
    const { decision } = run({ content: 'hola?', s: 2 }, [inbound('Quiero hablar con una persona', 0, 'image')])
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
  })

  it('SecureDog r3 #2: "agente" + a photo captioned "mire esto" → "agente" is still checked alone', () => {
    const { burst, decision } = run({ content: 'mire esto', messageType: 'image', s: 2 }, [inbound('agente', 0)])
    assert.equal(burst.inboundText, 'agente\nmire esto')
    assert.equal(decision.handled, true)
    assert.equal(decision.handoff?.kind, 'handoff')
    // A WhatsApp document whose "caption" is its file name: still a hand-off, the name never joins the text.
    const doc = run({ content: 'IMG-20261017.pdf', messageType: 'document', s: 2 }, [inbound('agente', 0)])
    assert.equal(doc.burst.inboundText, 'agente')
    assert.equal(doc.decision.handoff?.kind, 'handoff')
    // "[STOP]" typed by the customer is text: it still stops the bot.
    assert.equal(run({ content: 'hola', s: 2 }, [inbound('[STOP]', 0)]).decision.handoff?.kind, 'handoff')
  })

  it('a payment claim in an earlier bubble still goes to a person', () => {
    assert.equal(run({ content: 'gracias', s: 2 }, [inbound('Ya te hice el sinpe', 0)]).decision.handoff?.kind, 'handoff')
  })

  it('Verifier r3 #1 (High): an earlier question is never dropped because the newest bubble got a code reply', () => {
    const { decision } = run({ content: '¿Cómo pago?', s: 3 }, [outbound('¡Hola! ¿En qué te ayudo?', -60), inbound('Quiero 2 del kit grande con envío a Limón', 0)], SHARED)
    assert.equal(decision.handled, false, 'the model answers the order and how to pay together')
    assert.ok(decision.decisionTrace.steps.some((s) => s.step === 'burst_model' && s.reason === 'other_bubble_needs_model'))
    // A greeting asks nothing: the code reply stays.
    const hello = run({ content: '¿Cómo pago?', s: 3 }, [inbound('Hola', 0)], SHARED)
    assert.equal(hello.decision.shortcutKey, 'sys_payment_info')
    // Alone it is still the code reply.
    assert.equal(run({ content: '¿Cómo pago?', s: 0 }, [], SHARED).decision.shortcutKey, 'sys_payment_info')
  })

  it('Verifier r4 #1: two different code replies in one burst ("¿Cómo pago?" + "¿Precio?") → the model answers both', () => {
    const payFirst = run({ content: '¿Precio?', s: 3 }, [inbound('¿Cómo pago?', 0)], SHARED, [PRICE_REPLY])
    assert.equal(payFirst.decision.handled, false)
    const priceFirst = run({ content: '¿Cómo pago?', s: 3 }, [inbound('¿Precio?', 0)], SHARED, [PRICE_REPLY])
    assert.equal(priceFirst.decision.handled, false)
    // The same code reply twice ("¿Precio?" + "precio por favor") is one answer: the code reply stays.
    const same = run({ content: 'precio por favor', s: 3 }, [inbound('¿Precio?', 0)], SHARED, [PRICE_REPLY])
    assert.equal(same.decision.shortcutKey, 'owner_precio')
    // Alone, the owner's reply goes out as written.
    assert.equal(run({ content: '¿Precio?', s: 0 }, [], SHARED, [PRICE_REPLY]).decision.shortcutKey, 'owner_precio')
  })

  it('Verifier r4 #2: "Lo quiero" + "¿Hacen envíos a Limón?" keeps the buy cue for the one turn', () => {
    const ctx = {
      catalog: [{ name: 'GLP-1', price: 15900, stockLabel: 'disponible' }],
      shippingMethods: [{ name: 'Correos', price: 5000, coverage: 'todo el país', cod: 'no' }],
      orderFields: ['Nombre', 'Teléfono'],
      salesScript: '',
      aiDisclosure: 'discreet',
      paymentShareable: true,
      paymentDigits: ['62019914'],
      promo: null,
      bundles: [],
      paymentMethods: ['sinpe'],
      cardOnWeb: false,
    } as unknown as SalesContext
    const history = [outbound('El GLP-1 cuesta ₡15.900 😊', -60), inbound('Lo quiero', 0)]
    assert.equal(deriveSalesState({ history, inboundText: '¿Hacen envíos a Limón?', ctx }).buyCue, true)
    // Verifier r5 #1: a later retraction cancels it; a single message keeps today's rule.
    assert.equal(deriveSalesState({ history, inboundText: 'Ah no, mejor no', ctx }).buyCue, false)
    assert.equal(deriveSalesState({ history, inboundText: 'Ah no.', ctx }).buyCue, false)
    assert.equal(deriveSalesState({ history, inboundText: 'olvidalo', ctx }).buyCue, false)
    // Verifier r6 #2: these do not take the purchase back.
    for (const t of ['ya no tengo dudas', 'Ah no sabía, ¿y el envío?', '¿Hacen envíos a Limón?']) {
      assert.equal(deriveSalesState({ history, inboundText: t, ctx }).buyCue, true, t)
    }
    assert.equal(deriveSalesState({ history: history.slice(0, 1), inboundText: 'Lo quiero, ya no tengo dudas', ctx }).buyCue, true)
    assert.equal(deriveSalesState({ history: history.slice(0, 1), inboundText: 'no lo quiero', ctx }).buyCue, false)
    // Verifier r5 #2: the receipt check reads the newest message only.
    assert.equal(deriveSalesState({ history, inboundText: '', ctx, burstBuyCue: false }).buyCue, false)
    assert.match(read('src/lib/soft-ai/sales-state.ts'), /deriveSalesState\(\{ history, inboundText: '', ctx, burstBuyCue: false \}\)/)
    // Once the store answered, an old "lo quiero" does not count again.
    const answered = [...history, outbound('¡Genial! ¿A qué zona?', 30)]
    assert.equal(deriveSalesState({ history: answered, inboundText: '¿Hacen envíos a Limón?', ctx }).buyCue, false)
  })

  it('payment data sent by hand: the model answers both questions and the payment_details review is kept (either order)', () => {
    const newest = run({ content: '¿Cómo pago?', s: 3 }, [inbound('¿hacen envíos a Limón?', 0)])
    assert.equal(newest.decision.handled, false)
    assert.deepEqual(newest.burstReview, { kind: 'review', reason: 'payment_details' })
    const earliest = run({ content: '¿y hacen envíos?', s: 2 }, [inbound('¿Cómo pago?', 0)])
    assert.equal(earliest.decision.handled, false)
    assert.deepEqual(earliest.burstReview, { kind: 'review', reason: 'payment_details' })
  })

  it('resolveBurstDecision / burstReviewFor precedence', () => {
    type D = { handled: boolean; handoff: TurnHandoff | null; shortcutKey: string | null }
    const model: D = { handled: false, handoff: null, shortcutKey: null }
    const code: D = { handled: true, handoff: null, shortcutKey: 'sys_payment_info' }
    const optout: D = { handled: true, handoff: { kind: 'handoff', reason: 'human_request' }, shortcutKey: 'sys_handoff_optout' }
    const soon: D = { handled: true, handoff: { kind: 'review', reason: 'payment_details' }, shortcutKey: 'sys_payment_soon' }
    const toModel = (d: D): D => ({ ...d, handled: false, handoff: null, shortcutKey: null })
    assert.equal(resolveBurstDecision(optout, [{ text: 'x', decision: model }], toModel).decision, optout)
    assert.equal(resolveBurstDecision(code, [{ text: 'STOP', decision: optout }], toModel).decision, optout)
    assert.equal(resolveBurstDecision(code, [{ text: 'quiero 2', decision: model }], toModel).decision.handled, false)
    assert.equal(resolveBurstDecision(code, [{ text: 'hola', decision: model }], toModel).decision, code)
    assert.deepEqual(resolveBurstDecision(soon, [{ text: '¿envíos?', decision: model }], toModel).carriedReview, soon.handoff)
    assert.equal(burstReviewFor({ decision: soon, others: [{ decision: soon }], mediaReview: true }), null)
    assert.deepEqual(burstReviewFor({ decision: model, others: [], mediaReview: true }), { kind: 'review', reason: 'review' })
  })
})

describe('burst = one reply · media + text', () => {
  it('User 722630: "Que costo tiene" + photo → the price question is answered, a person looks at the photo', () => {
    const { burst, decision, burstReview } = run({ content: '[image]', messageType: 'image', s: 2 }, [inbound('Que costo tiene', 0)])
    assert.equal(burst.reason, 'media_with_text')
    assert.equal(burst.inboundText, 'Que costo tiene')
    assert.notEqual(decision.shortcutKey, 'sys_media_ask')
    assert.equal(decision.handled, false)
    assert.deepEqual(burstReview, { kind: 'review', reason: 'review' })
  })

  it('photo first, then "¿cuánto cuesta?"; caption joined; send order beats job order', () => {
    const photoFirst = run({ content: '¿cuánto cuesta?', s: 3 }, [inbound('[image]', 0, 'image')])
    assert.equal(photoFirst.burst.reason, 'text_with_media')
    assert.deepEqual(photoFirst.burstReview, { kind: 'review', reason: 'review' })
    assert.equal(run({ content: '¿lo tienen en M?', messageType: 'image', s: 2 }, [inbound('Hola', 0)]).burst.inboundText, 'Hola\n¿lo tienen en M?')
    const inverted = run({ content: '[image]', messageType: 'image', s: 0 }, [inbound('¿cuánto cuesta este?', 2)])
    assert.equal(inverted.burst.inboundText, '¿cuánto cuesta este?')
    assert.equal(run({ content: '[image]', messageType: 'image', s: 2 }, [inbound('[share]', 0)]).decision.shortcutKey, 'sys_media_ask')
  })

  it('image-only and audio-only keep today\'s behaviour (ask in writing + review)', () => {
    for (const messageType of ['image', 'audio', 'voice']) {
      const { burst, decision, burstReview } = run({ content: `[${messageType}]`, messageType, s: 0 }, [outbound('¡Hola!', -60)])
      assert.equal(burst.reason, 'single')
      assert.equal(decision.shortcutKey, 'sys_media_ask')
      assert.deepEqual(decision.handoff, { kind: 'review', reason: 'review' })
      assert.equal(burstReview, null, 'the decision\'s own review — no second alert')
    }
    assert.equal(run({ content: '[image]', messageType: 'image', s: 2 }, [inbound('[image]', 0, 'image')]).decision.shortcutKey, 'sys_media_ask')
  })

  it('a receipt-looking photo keeps the receipt path, alone or with text in the burst', () => {
    assert.equal(runAwaitingReceipt({ content: '[image]', messageType: 'image', s: 0 }, []).decision.shortcutKey, 'sys_handoff_media')
    assert.equal(runAwaitingReceipt({ content: '[image]', messageType: 'image', s: 2 }, [inbound('ahí va', 0)]).decision.shortcutKey, 'sys_handoff_media')
    const photoThenText = runAwaitingReceipt({ content: 'listo', s: 2 }, [inbound('[image]', 0, 'image')])
    assert.equal(photoThenText.burst.reason, 'burst_receipt')
    assert.deepEqual(photoThenText.decision.handoff, { kind: 'handoff', reason: 'payment' })
    const caption = run({ content: 'listo', s: 2 }, [inbound('comprobante sinpe', 0, 'image')])
    assert.equal(caption.burst.reason, 'burst_receipt')
    assert.equal(caption.decision.shortcutKey, 'sys_handoff_media')
  })

  it('a sticker after text: the text is answered, nobody needs to look at a sticker', () => {
    const { burst, burstReview } = run({ content: '[sticker]', messageType: 'sticker', s: 2 }, [inbound('¿tienen envíos?', 0)])
    assert.equal(burst.reason, 'media_with_text')
    assert.equal(burstReview, null)
  })

  it('a caption opt-out on the newest photo keeps its own path (MEDIA-14)', () => {
    const { burst, decision } = run({ content: 'quiero hablar con una persona', messageType: 'image', s: 2 }, [inbound('hola', 0)])
    assert.equal(burst.reason, 'single')
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
  })
})

describe('burst = one reply · wiring (source)', () => {
  it('live and Probar both call decideBurstTurn and answer the planned text', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    const probar = turn.slice(turn.indexOf('async function runAgentTestTurnInner'))
    // D2 merge: the burst decision feeds the "¿ya pagó?" check (payment-claim-check.test.ts), review kept apart.
    assert.match(live, /const burstTurn = decideBurstTurn\(\{/)
    assert.match(live, /const \{ burstReview \} = burstTurn/)
    assert.match(live, /burstTurn\.decision,/)
    assert.match(probar, /const probarBurstTurn = decideBurstTurn\(\{/)
    assert.match(probar, /const probarBurstReview = probarBurstTurn\.burstReview/)
    assert.match(probar, /probarBurstTurn\.decision,/)
    assert.match(live, /history,\s+inboundText: burst\.inboundText,\s+clientName/)
    assert.match(live, /customerText: burstCustomerText\(history, burst\.inboundText\)/)
    assert.match(probar, /history,\s+inboundText: probarBurst\.inboundText,\s+clientName/)
    assert.match(probar, /customerText: customerTextSinceLastAnswer\(input\.history \?\? \[\], probarBurst\.inboundText\)/)
    // Verifier r6 #1: Probar loads the sale's state for a photo earlier in the burst too (like live).
    assert.match(probar, /isMediaLikeMessageType\(input\.messageType\) \|\| probarBurstEarlier\.some\(\(m\) => isMediaLikeMessageType\(m\.messageType\)\)/)
    // Probar keeps each history message's type (a photo earlier in the burst is planned like live).
    assert.match(probar, /\.\.\.\(message\.messageType \? \{ messageType: message\.messageType \} : \{\}\),/)
    // Probar shows the review live would raise (display only).
    assert.match(probar, /handoff: handoff \?\? probarBurstReview,/)
  })

  it('the burst review rides apart from the hand-off and survives a lease reclaim', () => {
    const step = burstTraceStep({ reason: 'media_with_text' }, { kind: 'review', reason: 'payment_details' }, true)
    assert.deepEqual(step, { step: 'burst', outcome: 'media_with_text', reason: 'review:payment_details', optOut: true })
    assert.deepEqual(burstReviewIn({ steps: [step] }), { kind: 'review', reason: 'payment_details' })
    assert.equal(burstOptOutIn({ steps: [step] }), true)
    assert.equal(burstReviewIn({ steps: [burstTraceStep({ reason: 'single' }, null)] }), null)
    assert.equal(burstReviewIn(null), null)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    assert.match(live, /burstReview: burstReviewIn\(existing\.decisionTrace\),/)
    assert.match(live, /handoff: plan\.handoff,\s+burstReview,/)
    assert.match(live, /handoff: modelPlan\.handoff,\s+burstReview,/)
    const finish = turn.slice(turn.indexOf('async function finishDeliveryOrSuggest('), turn.indexOf('async function finishDeliveryOrSuggestInner'))
    assert.match(finish, /else if \(input\.burstReview\) \{\s+await settleHandoff\(input\.row, input\.burstReview, input\.afterHours\)/)
    assert.match(finish, /if \(!input\.handoff && \(result\.status === 'suggested' \|\| result\.status === 'skipped'\)\)/)
  })

  it('Probar sandbox: a reply to an earlier queued message is in the history of the next one', () => {
    const ui = read('src/app/config/agentes/AgentTestSandbox.tsx')
    assert.match(ui, /all\.filter\(\(b, i\) => i !== idx && !\(i > idx && b\.from === 'customer'\)\)/)
  })

  it('decideInbound alone is unchanged for a single message', () => {
    assert.equal(decideInbound({ inboundText: '[image]', messageType: 'image', brandFacts: facts, shortcuts }).shortcutKey, 'sys_media_ask')
  })
})

describe('burst hardening · every bubble checked, a day at most, newest message answers', () => {
  const DAY_S = BURST_MAX_AGE_MS / 1000

  it('an unanswered STOP from days ago is not part of a new "hola" burst; inside the day it is', () => {
    const old = [inbound('STOP', -3 * DAY_S)]
    assert.deepEqual(unansweredBurst(old, { sentAt: at(0) }), [])
    const hola = run({ content: 'hola', s: 0 }, old)
    assert.equal(hola.optOut, false)
    assert.notEqual(hola.decision.handoff?.kind, 'handoff')
    // Same day: still a burst bubble → opt-out hand-off, the waiting ack stays silent.
    const sameDay = run({ content: 'hola', s: 0 }, [inbound('STOP', -(DAY_S - 60))])
    assert.equal(sameDay.optOut, true)
    assert.equal(sameDay.decision.handoff?.kind, 'handoff')
    // The bound ends the run at the first too-old bubble (history is in sent order).
    const mixed = [inbound('ya pagué', -2 * DAY_S), inbound('¿precio?', -30), inbound('después', 5)]
    assert.deepEqual(unansweredBurst(mixed, { sentAt: at(0) }).map((m) => m.content), ['¿precio?', 'después'])
    // A bad date never drops a bubble (Probar / legacy rows); no trigger → no bound.
    assert.equal(unansweredBurst([inbound('STOP', 0)], { sentAt: 'no-date' }).length, 1)
    assert.equal(unansweredBurst([{ ...inbound('STOP', 0), sentAt: 'x' }], { sentAt: at(0) }).length, 1)
    assert.equal(unansweredBurst(old).length, 1)
  })

  it('an unanswered receipt photo from days ago does not turn a new "hola" into the receipt path', () => {
    // Real order: payment data 3 days ago, the photo 2 days ago, "hola" now.
    const stale = runAwaitingReceipt({ content: 'hola', s: 0 }, [inbound('[image]', -2 * DAY_S, 'image')], -3 * DAY_S)
    assert.equal(stale.burst.reason, 'single')
    const fresh = runAwaitingReceipt({ content: 'hola', s: 0 }, [inbound('[image]', -60, 'image')])
    assert.equal(fresh.burst.reason, 'burst_receipt')
  })

  it('the shadow replay measures the 24 h bound from the real message time (Probar API cannot set it)', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(turn, /const probarTrigger = \{ content: input\.inboundText, messageType: input\.messageType \|\| 'text', sentAt: input\.replaySentAt \?\? new Date\(\) \}/)
    assert.match(read('scripts/agent-pack/shadow.ts'), /replaySentAt: m\.sentAt,/)
    assert.doesNotMatch(read('src/lib/soft-ai/agent-admin.ts'), /replaySentAt/)
  })

  it('the bound matches the waiting sweep\'s 24 h reply window', () => {
    assert.equal(BURST_MAX_AGE_MS, 24 * 60 * 60_000)
    assert.match(read('src/lib/soft-ai/waiting-sweep.ts'), /const DAY_MS = 24 \* 60 \* 60_000/)
  })

  it('a burst longer than the 24-row window (WhatsApp multi-forward) is loaded on its own: its first STOP still counts', () => {
    const bubbles = [
      outbound('¡Hola! Soy Sofi', -600),
      inbound('STOP', -100),
      ...Array.from({ length: 29 }, (_, i) => inbound(`reenviado ${i}`, -90 + i)),
    ]
    const window = bubbles.slice(-HISTORY_WINDOW_MAX)
    const windowBurst = unansweredBurst(window, { sentAt: at(0) })
    assert.equal(burstOutgrowsWindow({ loadedRows: window.length, windowMax: HISTORY_WINDOW_MAX, history: window, burst: windowBurst }), true)
    // The 24-row window alone misses the STOP …
    assert.equal(run({ content: 'hola', s: 0 }, window).optOut, false)
    // … the separate load (every unanswered inbound) catches it.
    const full = run({ content: 'hola', s: 0 }, bubbles)
    assert.equal(full.optOut, true)
    assert.equal(full.decision.handoff?.kind, 'handoff')
    // Not needed when the window is not full, holds the store's reply, or the day bound already ended the run.
    const short = bubbles.slice(-5)
    assert.equal(burstOutgrowsWindow({ loadedRows: 5, windowMax: HISTORY_WINDOW_MAX, history: short, burst: unansweredBurst(short) }), false)
    const withReply = [outbound('ok', -95), ...bubbles.slice(-23)]
    assert.equal(burstOutgrowsWindow({ loadedRows: 24, windowMax: HISTORY_WINDOW_MAX, history: withReply, burst: unansweredBurst(withReply) }), false)
    const aged = [inbound('viejo', -2 * DAY_S), ...bubbles.slice(-23)]
    assert.equal(
      burstOutgrowsWindow({ loadedRows: 24, windowMax: HISTORY_WINDOW_MAX, history: aged, burst: unansweredBurst(aged, { sentAt: at(0) }) }),
      false,
    )
    assert.equal(burstOutgrowsWindow({ loadedRows: 24, windowMax: HISTORY_WINDOW_MAX, history: [], burst: [] }), false)
  })

  it('live loads a long burst tenant- and chat-scoped, after the last reply, inside the day, newest 100, text/type/time only', () => {
    assert.equal(BURST_LOAD_MAX, 100)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const fn = turn.slice(turn.indexOf('async function loadUnansweredInbound'), turn.indexOf('async function yieldsToNewerBurst'))
    assert.match(fn, /tenantId: input\.tenantId,\s+conversationId: input\.conversationId,\s+direction: 'inbound',\s+id: \{ not: input\.triggerMessageId \},/)
    // After the last reply in (sentAt, id) order, like the history window (same-second tie kept).
    assert.match(fn, /select: \{ id: true, sentAt: true \}/)
    assert.match(
      fn,
      /lastReply && lastReply\.sentAt >= since\s+\? \{ OR: \[\{ sentAt: \{ gt: lastReply\.sentAt \} \}, \{ sentAt: lastReply\.sentAt, id: \{ gt: lastReply\.id \} \}\] \}\s+: \{ sentAt: \{ gte: since \} \}/,
    )
    assert.match(fn, /take: BURST_LOAD_MAX,\s+select: \{ content: true, messageType: true, sentAt: true \},/)
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    assert.match(
      live,
      /const burstEarlier = burstOutgrowsWindow\(\{ loadedRows, windowMax: HISTORY_WINDOW_MAX, history, burst: windowBurst \}\)\s+\? unansweredBurst\(\s+await loadUnansweredInbound\(\{\s+tenantId: row\.tenantId,\s+conversationId: row\.conversationId,/,
    )
    // The model keeps its 24-row window.
    assert.match(turn, /take: HISTORY_WINDOW_MAX,/)
  })

  it('the claim answers with the newest SENT message: a late-delivered bubble never takes the burst; single-flight kept', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    const claim = queue.slice(queue.indexOf('async function claimRows'), queue.indexOf('export function claimBatch'))
    assert.match(claim, /JOIN "ChatMessage" current_msg ON current_msg\."id" = current\."messageId"/)
    assert.match(claim, /JOIN "ChatMessage" newer_msg ON newer_msg\."id" = newer\."messageId"/)
    assert.match(claim, /\(newer_msg\."sentAt", newer\."createdAt", newer\."id"\) > \(current_msg\."sentAt", current\."createdAt", current\."id"\)/)
    assert.match(claim, /ORDER BY current_msg\."sentAt" DESC, current\."createdAt" DESC, current\."id" DESC\s+FOR UPDATE OF current SKIP LOCKED/)
    assert.match(claim, /inflight\."status" = 'processing'/)
    assert.match(claim, /ChatAutomationJob_conversation_single_flight/)
    assert.deepEqual(NEWEST_BURST_JOB_ORDER, [{ message: { sentAt: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }])
    const proc = read('src/lib/soft-ai/automation-processor.ts')
    const kick = proc.slice(proc.indexOf('export async function kickNextConversationJob'), proc.indexOf('export async function processClaimedJob'))
    assert.match(kick, /orderBy: NEWEST_BURST_JOB_ORDER,/)
  })
})

describe('burst hardening · SecureDog r1 (superseded = checked, per-turn CPU, bounded reply lookup)', () => {
  it('F1: a job whose message already has a store reply after it is never superseded — it runs on its own afterwards', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    const fn = queue.slice(queue.indexOf('async function supersedeOlderJobs'), queue.indexOf('async function deferJob'))
    assert.match(fn, /WHERE job\."conversationId" = \$\{conversationId\}\s+AND job\."id" <> \$\{keepId\}\s+AND job\."status" IN \('pending', 'retry'\)/)
    assert.match(fn, /AND NOT EXISTS \(\s+SELECT 1\s+FROM "ChatMessage" msg\s+JOIN "ChatMessage" reply/)
    assert.match(fn, /reply\."conversationId" = msg\."conversationId"\s+AND reply\."tenantId" = msg\."tenantId"\s+AND reply\."direction" = 'outbound'\s+AND \(reply\."sentAt", reply\."id"\) > \(msg\."sentAt", msg\."id"\)/)
    assert.match(fn, /WHERE msg\."id" = job\."messageId"/)
    assert.match(fn, /"lastErrorCode" = 'SUPERSEDED'/)
    assert.match(fn, /"payload" = NULL/)
    // A tagged template: every value is a bound parameter.
    assert.match(fn, /await prisma\.\$executeRaw`/)
    assert.doesNotMatch(fn, /executeRawUnsafe|Prisma\.raw/)
  })

  it('F2: whitespace runs collapse and repeated bubbles are decided once (per-bubble checks only)', () => {
    const spam = Array.from({ length: 100 }, (_, i) => inbound(`a${' '.repeat(4000)}x`, -100 + i))
    const others = burstOtherTexts(spam, { inboundText: 'hola' })
    assert.deepEqual(others, [{ text: 'a x', messageType: 'text' }])
    assert.deepEqual(
      burstOtherTexts([inbound('¿Cómo   pago?', 0), inbound('¿Cómo pago?', 1), inbound('¿Cómo pago?', 2, 'image')], { inboundText: 'hola' }),
      [
        { text: '¿Cómo pago?', messageType: 'text' },
        { text: '¿Cómo pago?', messageType: 'image' },
      ],
    )
    // The planned text itself (with its own spacing) is not checked twice.
    assert.deepEqual(burstOtherTexts([inbound('Quiero  2 \n\n  cajas', 0)], { inboundText: 'Quiero 2\ncajas' }), [])
    // Verifier r3: a line break stays a line break (the payment classifier reads it as a sentence end).
    assert.deepEqual(burstOtherTexts([inbound(`Quiero pagar con tarjeta${'\n'.repeat(4000)}le hice uno`, 0)], { inboundText: 'hola?' }), [
      { text: 'Quiero pagar con tarjeta\nle hice uno', messageType: 'text' },
    ])
    const alone = decideInbound({ inboundText: 'Quiero pagar con tarjeta\nle hice uno\nfunciona?', messageType: 'text', brandFacts: facts, shortcuts })
    assert.equal(alone.handoff?.kind, 'handoff')
    const burstPay = run({ content: 'hola?', s: 2 }, [inbound('Quiero pagar con tarjeta\nle hice uno\nfunciona?', 0)])
    assert.equal(burstPay.decision.handoff?.kind, 'handoff')
    assert.equal(burstPay.decision.handoff?.reason, alone.handoff?.reason)
    // A STOP followed by a long run of spaces / newlines is still a STOP.
    assert.equal(run({ content: 'hola', s: 2 }, [inbound(`no me escriban más${' '.repeat(4000)}`, 0)]).optOut, true)
    assert.equal(run({ content: 'hola', s: 2 }, [inbound(`STOP${'\n'.repeat(4000)}`, 0)]).optOut, true)
    const t0 = Date.now()
    run({ content: 'hola', s: 200 }, Array.from({ length: 100 }, (_, i) => inbound(`no me escriban${' '.repeat(4000)}x${i}`, i)))
    assert.ok(Date.now() - t0 < 500, `100 adversarial bubbles took ${Date.now() - t0} ms`)
    assert.match(read('src/lib/soft-ai/waiting-ack.ts'), /\(\\s\+por\\s\+favor\)\?\[\\s\.!\]\*\$\|/)
  })

  it('F3: the last-reply lookup is bounded by the day', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const fn = turn.slice(turn.indexOf('async function loadUnansweredInbound'), turn.indexOf('async function yieldsToNewerBurst'))
    assert.match(fn, /where: \{ tenantId: input\.tenantId, conversationId: input\.conversationId, direction: 'outbound', sentAt: \{ gte: since \} \}/)
  })
})

describe('burst hardening · Verifier r3 (an answered late job never takes over a newer job on retry)', () => {
  it('a job whose message already has a store reply after it waits for every newer job, also one on a long retry', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    const claim = queue.slice(queue.indexOf('async function claimRows'), queue.indexOf('export function claimBatch'))
    assert.match(
      claim,
      /newer\."availableAt" <= CURRENT_TIMESTAMP \+ \$\{Prisma\.raw\(`INTERVAL '\$\{BURST_HOLD_SECONDS\} seconds'`\)\}[\s\S]{0,400}OR EXISTS \(\s+SELECT 1\s+FROM "ChatMessage" reply\s+WHERE reply\."conversationId" = current_msg\."conversationId"\s+AND reply\."tenantId" = current_msg\."tenantId"\s+AND reply\."direction" = 'outbound'\s+AND \(reply\."sentAt", reply\."id"\) > \(current_msg\."sentAt", current_msg\."id"\)/,
    )
  })
})

describe('burst hardening · SecureDog F6 (a dead lease never blocks a chat or the cron)', () => {
  it('the single-flight conflict from $queryRaw (P2010 / 23505) is recognised, as is P2002; nothing else', async () => {
    const { Prisma } = await import('@prisma/client')
    const { isSingleFlightConflict } = await import('@/lib/soft-ai/automation-queue')
    const err = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError('Key ("conversationId")=(c1) already exists.', { code, clientVersion: 'test', meta })
    assert.equal(isSingleFlightConflict(err('P2010', { code: '23505' })), true)
    assert.equal(isSingleFlightConflict(err('P2002')), true)
    assert.equal(isSingleFlightConflict(err('P2010', { code: '40001' })), false)
    assert.equal(isSingleFlightConflict(err('P2010')), false)
    assert.equal(isSingleFlightConflict(new Error('unique')), false)
  })

  it('every claim first releases leases dead for 15 s (retry, or failed once out of attempts); a conflict defers, never throws', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    const release = queue.slice(queue.indexOf('async function releaseDeadLeases'), queue.indexOf('async function claimRows'))
    assert.match(release, /SET "status" = CASE WHEN "attempts" >= \$\{MAX_ATTEMPTS\} THEN 'failed' ELSE 'retry' END/)
    assert.match(release, /"leaseToken" = NULL,\s+"leaseExpiresAt" = NULL,/)
    assert.match(release, /WHERE "status" = 'processing'\s+AND "leaseExpiresAt" <= CURRENT_TIMESTAMP - \$\{Prisma\.raw\(`INTERVAL '\$\{DEAD_LEASE_GRACE_SECONDS\} seconds'`\)\}/)
    const claim = queue.slice(queue.indexOf('async function claimRows'), queue.indexOf('export function claimBatch'))
    // A failed release never blocks the claim; no catch-all regex hides unrelated errors (SecureDog r3).
    assert.match(claim, /await releaseDeadLeases\(\)\.catch\(\(error\) => \{[\s\S]{0,120}\}\)\s+try \{\s+const rows = await prisma\.\$queryRaw/)
    assert.doesNotMatch(claim, /single_flight\|unique/)
    assert.match(claim, /if \(isSingleFlightConflict\(error\)\) \{\s+if \(id\) await deferJob\(id\)\s+return \[\]/)
    // Verifier r5: any processing sibling blocks the chat (a dead one inside the grace never empties the batch).
    const inflight = claim.slice(claim.indexOf('FROM "ChatAutomationJob" inflight'), claim.indexOf('ORDER BY current_msg'))
    assert.match(inflight, /AND inflight\."status" = 'processing'\s+AND inflight\."id" <> current\."id"/)
    assert.doesNotMatch(inflight, /leaseExpiresAt/)
  })
})
