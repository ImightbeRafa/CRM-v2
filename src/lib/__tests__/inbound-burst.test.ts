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
  BURST_YIELD_MAX_AGE_MS,
  burstHasLaterBubble,
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
import { BURST_HOLD_SECONDS, BURST_SETTLE_MS } from '@/lib/soft-ai/automation-queue'
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
const PAYMENT_DETAILS_SENT = () => outbound('Perfecto 🙌 Hacé el SINPE al 6201-9914 y me mandás el comprobante por aquí', -120)

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
function runAwaitingReceipt(trigger: { content: string; messageType?: string; s: number }, burstBubbles: Msg[]) {
  const history = [PAYMENT_DETAILS_SENT(), ...burstBubbles]
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
  it('stops at the store\'s last reply wherever it sits; no time window; includes bubbles sent after the trigger', () => {
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
