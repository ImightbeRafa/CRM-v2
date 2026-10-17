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
  planBurstInbound,
  shouldYieldToNewerBurst,
  unansweredBurst,
  withBurstMediaReview,
  type BurstMessage,
} from '@/lib/soft-ai/inbound-burst'
import { BURST_HOLD_SECONDS, BURST_SETTLE_MS } from '@/lib/soft-ai/automation-queue'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
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
const noReceipt = () => false

/** What the live turn does: plan the burst, then the deterministic decision on the planned text. */
function decideBurst(trigger: { content: string; messageType: string; s: number }, history: BurstMessage[], awaitingReceipt = noReceipt) {
  const plan = planBurstInbound({
    trigger: { content: trigger.content, messageType: trigger.messageType, sentAt: at(trigger.s) },
    earlier: unansweredBurst(history, { sentAt: at(trigger.s) }),
    awaitingReceipt,
  })
  const decision = decideInbound({
    inboundText: plan.inboundText,
    messageType: plan.messageType,
    brandFacts: facts,
    shortcuts,
    awaitingReceipt: awaitingReceipt(plan.messageType),
  })
  return { plan, decision, handoff: withBurstMediaReview(decision.handled ? decision.handoff : null, plan.mediaReview) }
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

  it('the webhook dispatches after the settle time (cron stays the safety net)', () => {
    const webhook = read('src/app/api/chat/webhook/route.ts')
    assert.match(webhook, /processJobAfterSettle\(jobId\)/)
    assert.doesNotMatch(webhook, /void processJobById\(jobId\)/)
    const proc = read('src/lib/soft-ai/automation-processor.ts')
    assert.match(proc, /setTimeout\(\(\) => \{\s+void processJobById\(id\)\.catch/)
    assert.match(proc, /\}, BURST_SETTLE_MS \+ 250\)/)
  })

  it('the agent turn yields before the model and right before each send; delivery keys untouched', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    const yields = live.match(/if \(await yieldsToNewerBurst\(row, trigger\.sentAt\)\)/g) || []
    assert.equal(yields.length, 3)
    // Before the model: after the claim gates, before the pre-model gates / any token.
    assert.ok(live.indexOf('yieldsToNewerBurst') > live.indexOf('runClaimGates(') && live.indexOf('yieldsToNewerBurst') < live.indexOf('runPreModelGates('))
    // Before the send: each yield precedes its finishDeliveryOrSuggest and marks the generated row superseded.
    const sends = [...live.matchAll(/return finishDeliveryOrSuggest\(\{/g)].map((m) => m.index!)
    const sendYields = [...live.matchAll(/if \(await yieldsToNewerBurst\(row, trigger\.sentAt\)\) return markTurnSuperseded\(turn\.id\)/g)].map((m) => m.index!)
    assert.equal(sendYields.length, 2)
    assert.ok(sendYields[0] < sends[1] && sendYields[0] > sends[0])
    assert.ok(sendYields[1] < sends[2] && sendYields[1] > sends[1])
    assert.match(turn, /where: \{ id: turnId, status: 'generated' \},\s+data: \{ status: 'skipped', skipReason: 'superseded'/)
    assert.doesNotMatch(live, /deliveryKey: `/)
  })

  it('the IG ad burst (share + "Quiero más información") is one burst for the newest job', () => {
    const history = [outbound('¡Hola! Soy Sofi 😊', -3600), inbound('[ig_post] https://instagram.com/p/x', 0)]
    const earlier = unansweredBurst(history, { sentAt: at(1) })
    assert.equal(earlier.length, 1)
    assert.equal(earlier[0].content, '[ig_post] https://instagram.com/p/x')
    // Text + text: decided on the newest bubble as before (the model sees the share in its history).
    const { plan } = decideBurst({ content: '¡Hola! Quiero más información.', messageType: 'text', s: 1 }, history)
    assert.deepEqual(plan, { inboundText: '¡Hola! Quiero más información.', messageType: 'text', mediaReview: false, reason: 'single' })
  })

  it('"Top" + "GLP1": the earlier bubble belongs to the burst of the newest one', () => {
    const history = [inbound('Top', 0)]
    assert.equal(unansweredBurst(history, { sentAt: at(4) }).length, 1)
  })

  it('the burst stops at the store\'s last reply, at the window, and never reads past the trigger', () => {
    const history = [
      inbound('viejo', -BURST_WINDOW_MS / 1000 - 10),
      inbound('antes de la respuesta', -30),
      outbound('respuesta', -20),
      inbound('uno', -5),
      inbound('después del trigger', 5),
    ]
    assert.deepEqual(unansweredBurst(history, { sentAt: at(0) }).map((m) => m.content), ['uno'])
    assert.deepEqual(unansweredBurst([inbound('viejo', -BURST_WINDOW_MS / 1000 - 1)], { sentAt: at(0) }), [])
  })
})

describe('burst = one reply · media + text', () => {
  it('User 722630: "Que costo tiene" + photo → the price question is answered, a person looks at the photo', () => {
    const { plan, decision, handoff } = decideBurst({ content: '[image]', messageType: 'image', s: 2 }, [inbound('Que costo tiene', 0)])
    assert.equal(plan.reason, 'media_with_text')
    assert.equal(plan.inboundText, 'Que costo tiene')
    assert.equal(plan.messageType, 'text')
    assert.equal(plan.mediaReview, true)
    assert.notEqual(decision.shortcutKey, 'sys_media_ask')
    assert.doesNotMatch(decision.text, /por escrito/)
    assert.equal(decision.handled, false, 'the model answers the price question')
    assert.deepEqual(handoff, { kind: 'review', reason: 'review' })
  })

  it('photo first, then "¿cuánto cuesta?" → the text is answered, review for the photo', () => {
    const { plan, decision, handoff } = decideBurst({ content: '¿cuánto cuesta?', messageType: 'text', s: 3 }, [inbound('[image]', 0, 'image')])
    assert.equal(plan.reason, 'text_with_media')
    assert.equal(plan.inboundText, '¿cuánto cuesta?')
    assert.equal(decision.handled, false)
    assert.deepEqual(handoff, { kind: 'review', reason: 'review' })
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
    assert.deepEqual(photoThenText.handoff, { kind: 'handoff', reason: 'payment' })
    // A payment caption is a receipt too (no payment details given yet).
    const caption = decideBurst({ content: 'listo', messageType: 'text', s: 2 }, [inbound('comprobante sinpe', 0, 'image')])
    assert.equal(caption.plan.reason, 'burst_receipt')
    assert.equal(caption.decision.shortcutKey, 'sys_handoff_media')
  })

  it('a sticker after text: the text is answered, nobody needs to look at a sticker', () => {
    const { plan, handoff } = decideBurst({ content: '[sticker]', messageType: 'sticker', s: 2 }, [inbound('¿tienen envíos?', 0)])
    assert.equal(plan.reason, 'media_with_text')
    assert.equal(plan.mediaReview, false)
    assert.equal(handoff, null)
  })

  it('a caption opt-out on the photo keeps its own path (MEDIA-14)', () => {
    const { plan, decision } = decideBurst({ content: 'quiero hablar con una persona', messageType: 'image', s: 2 }, [inbound('hola', 0)])
    assert.equal(plan.reason, 'single')
    assert.equal(decision.shortcutKey, 'sys_handoff_optout')
  })

  it('a planned hand-off is never downgraded by the media review', () => {
    assert.deepEqual(withBurstMediaReview({ kind: 'handoff', reason: 'payment' }, true), { kind: 'handoff', reason: 'payment' })
    assert.equal(withBurstMediaReview(null, false), null)
    assert.deepEqual(withBurstMediaReview(null, true), { kind: 'review', reason: 'review' })
  })

  it('the live turn decides and answers the planned burst text (decision, model input and reply checks)', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const live = turn.slice(turn.indexOf('export async function executeAgentLayerTurn'), turn.indexOf('function persistedTurnStatus'))
    assert.match(live, /inboundText: burst\.inboundText,\s+messageType: burst\.messageType,/)
    assert.match(live, /awaitingReceipt: mediaAwaitingReceipt\(burst\.messageType, history, mediaSalesContext\)/)
    assert.match(live, /history,\s+inboundText: burst\.inboundText,\s+clientName/)
    assert.match(live, /customerText: burstCustomerText\(history, burst\.inboundText\)/)
    assert.match(live, /handoff: handledHandoff,/)
    assert.match(live, /handoff: modelHandoffPlanned,/)
  })
})
