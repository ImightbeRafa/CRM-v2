/**
 * Burst = one reply (PatchHouse Instagram, 2026-10-17). Pure functions + source asserts (no DB, no model calls).
 * 1) Two bubbles within seconds get ONE turn: the newest job answers the burst, older jobs are superseded.
 * 2) Media + text in the same burst: the text is answered, a person still looks at the media (review).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BURST_WINDOW_MS,
  BURST_YIELD_MAX_AGE_MS,
  burstMediaReviewIn,
  burstOtherTexts,
  pickBurstDecision,
  planBurstInbound,
  shouldYieldToNewerBurst,
  unansweredBurst,
  type BurstMessage,
} from '@/lib/soft-ai/inbound-burst'
import { BURST_HOLD_SECONDS, BURST_SETTLE_MS } from '@/lib/soft-ai/automation-queue'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import type { TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'

const read = (p: string) => readFileSync(p, 'utf8')
const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({
  ...row,
  id: `s-${index}`,
  isActive: true,
  sortOrder: index,
}))
const facts = parseBrandFacts({ schemaVersion: 1 })
const T0 = new Date('2026-10-17T15:00:00.000Z').getTime()
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const inbound = (content: string, s: number, messageType = 'text'): BurstMessage => ({ direction: 'inbound', content, messageType, sentAt: at(s) })
const outbound = (content: string, s: number): BurstMessage => ({ direction: 'outbound', content, messageType: 'text', sentAt: at(s) })
const noReceipt = (_type: string) => false

/** What the live turn does (agent-turn.ts): plan the burst, decide the planned text, keep another bubble's hand-off. */
function decideBurst(trigger: { content: string; messageType: string; s: number }, history: BurstMessage[], awaitingReceipt = noReceipt) {
  const earlier = unansweredBurst(history, { sentAt: at(trigger.s) })
  const plan = planBurstInbound({
    trigger: { content: trigger.content, messageType: trigger.messageType, sentAt: at(trigger.s) },
    earlier,
    awaitingReceipt,
  })
  const base = { brandFacts: facts, shortcuts }
  const decision = pickBurstDecision(
    decideInbound({ ...base, inboundText: plan.inboundText, messageType: plan.messageType, awaitingReceipt: awaitingReceipt(plan.messageType) }),
    burstOtherTexts(earlier, plan).map((o) => decideInbound({ ...base, inboundText: o.text, messageType: o.messageType, awaitingReceipt: false, earlierCustomerTexts: [] })),
  )
  return { plan, decision }
}

describe('burst = one reply · queue coalescing', () => {
  it('a running job yields to a newer queued bubble only while its trigger is fresh', () => {
    const trigger = new Date(T0)
    assert.equal(shouldYieldToNewerBurst({ newerPending: true, triggerSentAt: trigger, now: T0 + 5_000 }), true)
    assert.equal(shouldYieldToNewerBurst({ newerPending: false, triggerSentAt: trigger, now: T0 + 5_000 }), false)
    // A customer typing for minutes is still answered (no starvation).
    assert.equal(shouldYieldToNewerBurst({ newerPending: true, triggerSentAt: trigger, now: T0 + BURST_YIELD_MAX_AGE_MS }), false)
  })

  it('inbound jobs settle before they are claimable; a settling newer job holds the older ones back', () => {
    assert.ok(BURST_SETTLE_MS >= 2_000 && BURST_SETTLE_MS <= 5_000)
    assert.ok(BURST_HOLD_SECONDS * 1000 > BURST_SETTLE_MS)
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    assert.match(hook, /availableAt: new Date\(Date\.now\(\) \+ BURST_SETTLE_MS\)/)
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    assert.match(queue, /\.\.\.\(input\.availableAt \? \{ availableAt: input\.availableAt \} : \{\}\)/)
    // The NOT EXISTS "newer" check counts a newer pending job that becomes claimable within the hold horizon.
    assert.match(queue, /newer\."availableAt" <= CURRENT_TIMESTAMP \+ \$\{Prisma\.raw\(`INTERVAL '\$\{BURST_HOLD_SECONDS\} seconds'`\)\}/)
    assert.doesNotMatch(queue, /newer\."availableAt" <= CURRENT_TIMESTAMP\n/)
    // Single-flight and the claim-time supersede of older siblings are unchanged.
    assert.match(queue, /inflight\."status" = 'processing'/)
    assert.match(queue, /await supersedeOlderJobs\(row\.conversationId, row\.id\)/)
    // newerBurstJobPending is tenant + chat scoped, same kind, newer only.
    const fn = queue.slice(queue.indexOf('export async function newerBurstJobPending'), queue.indexOf('async function supersedeOlderJobs'))
    assert.match(fn, /tenantId: row\.tenantId,\s+conversationId: row\.conversationId/)
    assert.match(fn, /kind: SOFT_AI_JOB_KIND/)
    assert.match(fn, /status: \{ in: \['pending', 'retry'\] \}/)
    assert.match(fn, /createdAt: \{ gt: self\.createdAt \}/)
  })

  it('a bubble with no content never gets a job (it could only fail and would hold back the real question)', () => {
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    const enqueue = hook.slice(hook.indexOf('export async function enqueueSoftAiAfterInbound'))
    assert.ok(enqueue.indexOf("if (!(args.content || '').trim()) return { skippedReason: 'empty_content' }") > 0)
    assert.ok(enqueue.indexOf('empty_content') < enqueue.indexOf('persistJob('))
  })

  it('the webhook dispatches after the settle time; a superseded job always hands over to the newer one', () => {
    const webhook = read('src/app/api/chat/webhook/route.ts')
    assert.match(webhook, /processJobAfterSettle\(jobId\)/)
    assert.doesNotMatch(webhook, /void processJobById\(jobId\)/)
    const proc = read('src/lib/soft-ai/automation-processor.ts')
    assert.match(proc, /setTimeout\(\(\) => \{\s+void processJobById\(id\)\.catch/)
    assert.match(proc, /\}, BURST_SETTLE_MS \+ 250\)/)
    // A kicked job (kick: false) that yields still kicks the newer job (no wait for the cron).
    assert.match(proc, /result\.reason === 'superseded'/)
    assert.match(proc, /if \(kick \|\| superseded\) void kickNextConversationJob\(row\)/)
  })

  it('the agent turn yields before the model and right before each send — never a planned hand-off or a reclaim', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    // Before the model: after the claim gates, before the pre-model gates / any token.
    const pre = live.indexOf('if (await yieldsToNewerBurst(row, trigger.sentAt)) {')
    assert.ok(pre > live.indexOf('runClaimGates(') && pre < live.indexOf('runPreModelGates('))
    // Before the send: each yield precedes its finishDeliveryOrSuggest, passes the planned hand-off, marks the row.
    const sends = [...live.matchAll(/return finishDeliveryOrSuggest\(\{/g)].map((m) => m.index!)
    const handledYield = live.indexOf('if (await yieldsToNewerBurst(row, trigger.sentAt, plan.handoff)) return markTurnSuperseded(turn.id)')
    const modelYield = live.indexOf('if (await yieldsToNewerBurst(row, trigger.sentAt, modelPlan.handoff)) return markTurnSuperseded(turn.id)')
    assert.ok(handledYield > sends[0] && handledYield < sends[1])
    assert.ok(modelYield > sends[1] && modelYield < sends[2])
    const helper = turn.slice(turn.indexOf('async function yieldsToNewerBurst'), turn.indexOf('async function markTurnSuperseded'))
    assert.match(helper, /if \(plannedHandoff\?\.kind === 'handoff' \|\| row\.attempts > 1\) return false/)
    assert.match(turn, /where: \{ id: turnId, status: 'generated' \},\s+data: \{ status: 'skipped', skipReason: 'superseded'/)
    assert.doesNotMatch(live, /deliveryKey: `/)
  })

  it('a superseded generated reply still counts toward the daily token cap', () => {
    const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
    const fn = gates.slice(gates.indexOf('export async function loadDailyBilledTokens'), gates.indexOf('export async function loadDailyTestTokens'))
    assert.match(fn, /OR: \[\{ status: \{ notIn: \['skipped'\] \} \}, \{ skipReason: 'superseded' \}\]/)
  })

  it('the IG ad burst (share + "Quiero más información") is one burst for the newest job', () => {
    const history = [outbound('¡Hola! Soy Sofi 😊', -3600), inbound('[ig_post] https://instagram.com/p/x', 0)]
    const earlier = unansweredBurst(history, { sentAt: at(1) })
    assert.deepEqual(earlier.map((m) => m.content), ['[ig_post] https://instagram.com/p/x'])
    // Text + text: decided on the newest bubble as before (the model sees the share in its history).
    const { plan, decision } = decideBurst({ content: '¡Hola! Quiero más información.', messageType: 'text', s: 1 }, history)
    assert.deepEqual(plan, { inboundText: '¡Hola! Quiero más información.', messageType: 'text', mediaReview: false, reason: 'single' })
    assert.equal(decision.handled, false, 'one model answer for the whole burst')
  })

  it('"Top" + "GLP1": the newest job sees "Top" as part of its burst and answers once', () => {
    const history = [outbound('¡Hola! ¿En qué te ayudo?', -60), inbound('Top', 0)]
    const { plan, decision } = decideBurst({ content: 'GLP1', messageType: 'text', s: 4 }, history)
    assert.deepEqual(unansweredBurst(history, { sentAt: at(4) }).map((m) => m.content), ['Top'])
    assert.equal(plan.inboundText, 'GLP1')
    assert.equal(decision.handled, false)
  })

  it('the burst stops at the store\'s last reply wherever it sits, and keeps the window on both sides', () => {
    const history = [
      inbound('antes de la respuesta', -30),
      outbound('respuesta', -20),
      inbound('viejo', -BURST_WINDOW_MS / 1000 - 10),
      inbound('uno', -5),
      inbound('después del trigger', 5),
      inbound('mucho después', BURST_WINDOW_MS / 1000 + 10),
    ]
    assert.deepEqual(unansweredBurst(history, { sentAt: at(0) }).map((m) => m.content), ['uno', 'después del trigger'])
    // Verifier r1 #3: the store answered after this trigger was sent → that question is not answered again.
    const answered = [inbound('¿Cuánto cuesta?', 0), outbound('Cuesta ₡12.000', 4)]
    assert.deepEqual(unansweredBurst(answered, { sentAt: at(2) }), [])
    const again = decideBurst({ content: '[image]', messageType: 'image', s: 2 }, answered)
    assert.equal(again.plan.reason, 'single')
    assert.equal(again.decision.shortcutKey, 'sys_media_ask')
  })
})

describe('burst = one reply · hand-offs in any bubble', () => {
  it('Verifier r1 #1: "Quiero hablar con una persona" + "por favor" still goes to a person', () => {
    const { decision } = decideBurst({ content: 'por favor', messageType: 'text', s: 2 }, [inbound('Quiero hablar con una persona', 0)])
    assert.equal(decision.handled, true)
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
    assert.deepEqual(decision.handoff, { kind: 'handoff', reason: 'human_request' })
  })

  it('a payment claim in an earlier bubble still goes to a person', () => {
    const { decision } = decideBurst({ content: 'gracias', messageType: 'text', s: 2 }, [inbound('Ya te hice el sinpe', 0)])
    assert.equal(decision.handoff?.kind, 'handoff')
  })

  it('the newest bubble\'s own hand-off wins; plain earlier text never turns a reply into a hand-off', () => {
    const optOutNow = decideBurst({ content: 'quiero hablar con una persona', messageType: 'text', s: 2 }, [inbound('hola', 0)])
    assert.equal(optOutNow.decision.shortcutKey, 'sys_handoff_optout')
    const plain = decideBurst({ content: '¿tienen envíos?', messageType: 'text', s: 2 }, [inbound('hola', 0)])
    assert.equal(plain.decision.handled, false)
    type D = { handled: boolean; handoff: TurnHandoff | null }
    const main: D = { handled: true, handoff: { kind: 'review', reason: 'review' } }
    const other: D = { handled: true, handoff: { kind: 'handoff', reason: 'human_request' } }
    assert.equal(pickBurstDecision(main, [other]), other)
    const mainHandoff: D = { handled: true, handoff: { kind: 'handoff', reason: 'payment' } }
    assert.equal(pickBurstDecision(mainHandoff, [other]), mainHandoff)
    assert.equal(pickBurstDecision(main, [{ handled: false, handoff: null }]), main)
  })

  it('the planned text is not checked twice; placeholders are not customer text', () => {
    const earlier = [inbound('Que costo tiene', 0), inbound('[share]', 1), inbound('[image]', 2, 'image'), inbound('hola', 3, 'sticker')]
    assert.deepEqual(burstOtherTexts(earlier, { inboundText: 'Que costo tiene' }), [])
    assert.deepEqual(burstOtherTexts(earlier, { inboundText: 'otra cosa' }), [{ text: 'Que costo tiene', messageType: 'text' }])
  })

  it('Verifier r2 #1: a photo captioned "Quiero hablar con una persona" + "hola?" still goes to a person (MEDIA-14)', () => {
    const { plan, decision } = decideBurst({ content: 'hola?', messageType: 'text', s: 2 }, [inbound('Quiero hablar con una persona', 0, 'image')])
    assert.equal(plan.reason, 'text_with_media')
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
    assert.deepEqual(decision.handoff, { kind: 'handoff', reason: 'human_request' })
    // A plain caption is no hand-off: the text is answered, the photo goes to review.
    const plain = decideBurst({ content: 'hola?', messageType: 'text', s: 2 }, [inbound('mirá este', 0, 'image')])
    assert.equal(plain.decision.handled, false)
    assert.equal(plain.plan.mediaReview, true)
  })
})

describe('burst = one reply · media + text', () => {
  it('User 722630: "Que costo tiene" + photo → the price question is answered, a person looks at the photo', () => {
    const { plan, decision } = decideBurst({ content: '[image]', messageType: 'image', s: 2 }, [inbound('Que costo tiene', 0)])
    assert.equal(plan.reason, 'media_with_text')
    assert.equal(plan.inboundText, 'Que costo tiene')
    assert.equal(plan.messageType, 'text')
    assert.equal(plan.mediaReview, true)
    assert.notEqual(decision.shortcutKey, 'sys_media_ask')
    assert.doesNotMatch(decision.text, /por escrito/)
    assert.equal(decision.handled, false, 'the model answers the price question')
  })

  it('the photo\'s own caption is answered with the text; send order beats job order', () => {
    const captioned = decideBurst({ content: '¿lo tienen en M?', messageType: 'image', s: 2 }, [inbound('Hola', 0)])
    assert.equal(captioned.plan.inboundText, 'Hola\n¿lo tienen en M?')
    // Verifier r1 #8: the text bubble was sent after the photo but its job came first → still answered.
    const inverted = decideBurst({ content: '[image]', messageType: 'image', s: 0 }, [inbound('¿cuánto cuesta este?', 2)])
    assert.equal(inverted.plan.reason, 'media_with_text')
    assert.equal(inverted.plan.inboundText, '¿cuánto cuesta este?')
    // A bracket-only share is not text: photo + "[share]" stays "¿Me contás por escrito…?".
    const share = decideBurst({ content: '[image]', messageType: 'image', s: 2 }, [inbound('[share]', 0)])
    assert.equal(share.decision.shortcutKey, 'sys_media_ask')
  })

  it('photo first, then "¿cuánto cuesta?" → the text is answered, review for the photo', () => {
    const { plan, decision } = decideBurst({ content: '¿cuánto cuesta?', messageType: 'text', s: 3 }, [inbound('[image]', 0, 'image')])
    assert.equal(plan.reason, 'text_with_media')
    assert.equal(plan.inboundText, '¿cuánto cuesta?')
    assert.equal(plan.mediaReview, true)
    assert.equal(decision.handled, false)
  })

  it('image-only and audio-only keep today\'s behaviour (ask in writing + review)', () => {
    for (const messageType of ['image', 'audio', 'voice']) {
      const { plan, decision } = decideBurst({ content: `[${messageType}]`, messageType, s: 0 }, [outbound('¡Hola!', -60)])
      assert.equal(plan.reason, 'single')
      assert.equal(decision.shortcutKey, 'sys_media_ask')
      assert.deepEqual(decision.handoff, { kind: 'review', reason: 'review' })
    }
    // Two photos and no text: still "¿Me contás por escrito…?".
    const two = decideBurst({ content: '[image]', messageType: 'image', s: 2 }, [inbound('[image]', 0, 'image')])
    assert.equal(two.plan.reason, 'single')
    assert.equal(two.decision.shortcutKey, 'sys_media_ask')
  })

  it('a receipt-looking photo keeps the receipt path, alone or with text in the burst', () => {
    const awaiting = (t: string) => t === 'image'
    const alone = decideBurst({ content: '[image]', messageType: 'image', s: 0 }, [], awaiting)
    assert.equal(alone.decision.shortcutKey, 'sys_handoff_media')
    assert.equal(alone.decision.handoff?.kind, 'handoff')
    // Text first, then the receipt photo: the receipt wins.
    const textThenPhoto = decideBurst({ content: '[image]', messageType: 'image', s: 2 }, [inbound('ahí va', 0)], awaiting)
    assert.equal(textThenPhoto.plan.reason, 'single')
    assert.equal(textThenPhoto.decision.shortcutKey, 'sys_handoff_media')
    // Receipt photo, then "listo": the photo is never lost to the newer text.
    const photoThenText = decideBurst({ content: 'listo', messageType: 'text', s: 2 }, [inbound('[image]', 0, 'image')], awaiting)
    assert.equal(photoThenText.plan.reason, 'burst_receipt')
    assert.equal(photoThenText.decision.shortcutKey, 'sys_handoff_media')
    assert.deepEqual(photoThenText.decision.handoff, { kind: 'handoff', reason: 'payment' })
    // A payment caption is a receipt too (no payment details given yet).
    const caption = decideBurst({ content: 'listo', messageType: 'text', s: 2 }, [inbound('comprobante sinpe', 0, 'image')])
    assert.equal(caption.plan.reason, 'burst_receipt')
    assert.equal(caption.decision.shortcutKey, 'sys_handoff_media')
  })

  it('a sticker after text: the text is answered, nobody needs to look at a sticker', () => {
    const { plan } = decideBurst({ content: '[sticker]', messageType: 'sticker', s: 2 }, [inbound('¿tienen envíos?', 0)])
    assert.equal(plan.reason, 'media_with_text')
    assert.equal(plan.mediaReview, false)
  })

  it('a caption opt-out on the photo keeps its own path (MEDIA-14)', () => {
    const { plan, decision } = decideBurst({ content: 'quiero hablar con una persona', messageType: 'image', s: 2 }, [inbound('hola', 0)])
    assert.equal(plan.reason, 'single')
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
  })

  it('the photo review rides apart from the hand-off (images + repeat guard kept) and survives a lease reclaim', () => {
    assert.equal(burstMediaReviewIn({ steps: [{ step: 'burst', outcome: 'media_with_text', reason: 'media_review' }] }), true)
    assert.equal(burstMediaReviewIn({ steps: [{ step: 'burst', outcome: 'media_with_text' }] }), false)
    assert.equal(burstMediaReviewIn(null), false)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    assert.equal((live.match(/burstMediaReview: burst\.mediaReview,/g) || []).length, 2)
    assert.match(live, /burstMediaReview: burstMediaReviewIn\(existing\.decisionTrace\),/)
    assert.match(live, /handoff: plan\.handoff,\s+burstMediaReview/)
    assert.match(live, /handoff: modelPlan\.handoff,\s+burstMediaReview/)
    const finish = turn.slice(turn.indexOf('async function finishDeliveryOrSuggest('), turn.indexOf('async function finishDeliveryOrSuggestInner'))
    assert.match(finish, /else if \(input\.burstMediaReview\) \{\s+await settleHandoff\(input\.row, \{ kind: 'review', reason: HANDOFF_REASON\.review \}/)
  })

  it('the live turn decides and answers the planned burst text (decision, model input and reply checks)', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    assert.match(live, /inboundText: burst\.inboundText,\s+messageType: burst\.messageType,/)
    assert.match(live, /awaitingReceipt: mediaAwaitingReceipt\(burst\.messageType, history, mediaSalesContext\)/)
    assert.match(live, /burstOtherTexts\(burstEarlier, burst\)/)
    assert.match(live, /history,\s+inboundText: burst\.inboundText,\s+clientName/)
    assert.match(live, /customerText: burstCustomerText\(history, burst\.inboundText\)/)
  })
})
