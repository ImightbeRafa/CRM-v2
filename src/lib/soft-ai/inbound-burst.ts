/**
 * Burst = one reply (2026-10-17, PatchHouse Instagram).
 *
 * A customer often sends 2–3 bubbles within seconds: an ad share + "¡Hola! Quiero más información.", or "Que costo
 * tiene" + a photo. The queue holds the older jobs back while a newer one settles (automation-queue BURST_SETTLE_MS);
 * a job that is already running yields to a newer one before the model and right before the send. The newest job then
 * answers the whole unanswered burst.
 *
 * planBurstInbound decides WHAT that one job answers when the burst mixes media and text:
 * - a receipt-looking photo / file anywhere in the burst keeps the receipt path (a person checks it);
 * - media + customer text → the text is answered normally, and a person is still asked to look at the media (review);
 * - media alone keeps today's behaviour ("¿Me contás por escrito…?" + review; a sticker needs nobody).
 * pickBurstDecision keeps a TRUE hand-off of any other text bubble (opt-out, payment, hand-off keyword reply).
 * Pure: no DB, no clock except the `now` argument.
 */

import { isOptOutText, mediaInboundPlan } from '@/lib/soft-ai/llm/safety-router'
import type { TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'

/** A running job yields to a newer burst job only while its trigger is this young (no starvation on a long chat). */
export const BURST_YIELD_MAX_AGE_MS = 60_000
/** Other customer bubbles count as the same burst when sent this close to the trigger (and still unanswered). */
export const BURST_WINDOW_MS = 2 * 60_000

const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video', 'voice', 'sticker'])
/** A bubble that is only a bracket token ("[image]", "[share]", "[reaction]", "[location]") is not customer text. */
const PLACEHOLDER_RE = /^\s*\[[\p{L}\d_:-]+\]\s*$/u

export type BurstMessage = {
  direction: 'inbound' | 'outbound'
  content: string | null
  messageType?: string | null
  sentAt: string | Date
}

export type BurstTrigger = {
  content: string | null
  messageType?: string | null
  sentAt: string | Date
}

export type BurstInboundPlan = {
  /** What decideInbound / the model answer this turn. */
  inboundText: string
  messageType: string
  /** A photo / file / audio in the burst still needs a person to look (review alert after the reply). */
  mediaReview: boolean
  /** Trace: why this shape was chosen. */
  reason: 'single' | 'media_with_text' | 'text_with_media' | 'burst_receipt'
}

function isMedia(type: string | null | undefined): boolean {
  return MEDIA_TYPES.has(type || '')
}

function realText(content: string | null | undefined): string {
  const text = (content || '').trim()
  return PLACEHOLDER_RE.test(text) ? '' : text
}

function at(value: string | Date): number {
  return new Date(value).getTime()
}

/** Should a running job stop and let the newer job of the same chat answer the whole burst? */
export function shouldYieldToNewerBurst(input: { newerPending: boolean; triggerSentAt: Date; now?: number }): boolean {
  if (!input.newerPending) return false
  const age = (input.now ?? Date.now()) - input.triggerSentAt.getTime()
  return Number.isFinite(age) && age < BURST_YIELD_MAX_AGE_MS
}

/**
 * The customer's other bubbles of this burst, oldest first: inbound, after the store's LAST reply (wherever it sits,
 * also after the trigger: what it answered is not answered again), within BURST_WINDOW_MS of the trigger on either
 * side (jobs are created in arrival order, which can differ from send order). History never holds the trigger.
 */
export function unansweredBurst(history: BurstMessage[], trigger: Pick<BurstTrigger, 'sentAt'>): BurstMessage[] {
  const triggerAt = at(trigger.sentAt)
  const out: BurstMessage[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.direction === 'outbound') break
    if (Math.abs(triggerAt - at(m.sentAt)) > BURST_WINDOW_MS) continue
    out.unshift(m)
  }
  return out
}

/**
 * What the one job of a burst answers. `awaitingReceipt(type)` says whether a photo / file of that type would be the
 * receipt now (sales-state mediaAwaitingReceipt).
 */
export function planBurstInbound(input: {
  trigger: BurstTrigger
  earlier: BurstMessage[]
  awaitingReceipt: (messageType: string) => boolean
}): BurstInboundPlan {
  const triggerType = input.trigger.messageType || 'text'
  const single: BurstInboundPlan = {
    inboundText: input.trigger.content || '',
    messageType: triggerType,
    mediaReview: false,
    reason: 'single',
  }
  const others = input.earlier.filter((m) => m.direction === 'inbound')
  const otherMedia = others.filter((m) => isMedia(m.messageType))
  const otherTexts = others.filter((m) => !isMedia(m.messageType) && realText(m.content))
  if (!others.length) return single

  // MEDIA-14: a caption opt-out ("quiero hablar con una persona") keeps its own path.
  if (isMedia(triggerType) && isOptOutText(input.trigger.content || '')) return single

  // A receipt anywhere in the burst wins: the receipt path for that photo / file (never lost to the newer text).
  const receiptOf = (m: { messageType?: string | null; content: string | null }) =>
    m.messageType !== 'sticker' &&
    mediaInboundPlan({
      messageType: m.messageType,
      caption: m.content,
      awaitingReceipt: input.awaitingReceipt(m.messageType || ''),
    }) === 'receipt'
  if (isMedia(triggerType) && receiptOf(input.trigger)) return single
  const otherReceipt = [...otherMedia].reverse().find(receiptOf)
  if (otherReceipt) {
    return {
      inboundText: otherReceipt.content || '',
      messageType: otherReceipt.messageType || 'image',
      mediaReview: false,
      reason: 'burst_receipt',
    }
  }

  const reviewMedia = [...otherMedia, ...(isMedia(triggerType) ? [input.trigger] : [])].some(
    (m) => m.messageType !== 'sticker',
  )

  if (isMedia(triggerType)) {
    // "Que costo tiene" + photo: answer the text (and the photo's own caption), a person still looks at the photo.
    const lastText = otherTexts[otherTexts.length - 1]
    if (!lastText) return single
    const caption = realText(input.trigger.content)
    return {
      inboundText: [realText(lastText.content), caption].filter(Boolean).join('\n'),
      messageType: 'text',
      mediaReview: reviewMedia,
      reason: 'media_with_text',
    }
  }

  // Photo + "¿cuánto cuesta?": the text is answered as usual, a person still looks at the photo.
  if (otherMedia.length) {
    return { ...single, mediaReview: reviewMedia, reason: 'text_with_media' }
  }
  return single
}

/**
 * The burst's other real text bubbles and photo / audio captions not already in the planned text, each with its own
 * message type: each is checked for a TRUE hand-off (a caption "Quiero hablar con una persona" too — MEDIA-14).
 */
export function burstOtherTexts(
  earlier: BurstMessage[],
  plan: Pick<BurstInboundPlan, 'inboundText'>,
): Array<{ text: string; messageType: string }> {
  const planned = new Set(plan.inboundText.split('\n').map((t) => t.trim()))
  return earlier
    .filter((m) => m.direction === 'inbound' && m.messageType !== 'sticker')
    .map((m) => ({ text: realText(m.content), messageType: m.messageType || 'text' }))
    .filter((m) => m.text && !planned.has(m.text))
}

/**
 * The burst's decision: the planned text's own, unless it is not a TRUE hand-off and another text bubble of the
 * burst is one ("Quiero hablar con una persona" + "por favor"): that one wins, as when it had its own job.
 */
export function pickBurstDecision<T extends { handled: boolean; handoff: TurnHandoff | null }>(main: T, others: T[]): T {
  if (main.handled && main.handoff?.kind === 'handoff') return main
  return others.find((d) => d.handled && d.handoff?.kind === 'handoff') ?? main
}

/**
 * The review a person still owes the burst after the reply (the chat stays on IA), when the turn plans no hand-off of
 * its own: a review another bubble would have raised on its own job ("¿Cómo pago?" in a store that sends the payment
 * data by hand → payment_details), else the burst's photo / audio (review). "¿Me contás por escrito…?" of a photo
 * is the media review itself.
 */
export function burstReviewFor<T extends { handled: boolean; handoff: TurnHandoff | null; shortcutKey: string | null }>(input: {
  decision: T
  others: T[]
  mediaReview: boolean
}): TurnHandoff | null {
  if (input.decision.handoff) return null
  const other = input.others.find(
    (d) => d !== input.decision && d.handled && d.handoff?.kind === 'review' && d.shortcutKey !== 'sys_media_ask',
  )
  if (other?.handoff) return { kind: 'review', reason: other.handoff.reason }
  return input.mediaReview ? { kind: 'review', reason: 'review' } : null
}

const BURST_REVIEW_PREFIX = 'review:'

/** The decision-trace step that records the burst plan (and its owed review, so a lease reclaim settles it too). */
export function burstTraceStep(plan: Pick<BurstInboundPlan, 'reason'>, review: TurnHandoff | null) {
  return { step: 'burst', outcome: plan.reason, ...(review ? { reason: `${BURST_REVIEW_PREFIX}${review.reason}` } : {}) }
}

/** The burst review a turn's decision trace planned (lease reclaim), or null. */
export function burstReviewIn(trace: unknown): TurnHandoff | null {
  if (!trace || typeof trace !== 'object') return null
  const steps = (trace as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return null
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue
    const step = s as Record<string, unknown>
    if (step.step === 'burst' && typeof step.reason === 'string' && step.reason.startsWith(BURST_REVIEW_PREFIX)) {
      const reason = step.reason.slice(BURST_REVIEW_PREFIX.length)
      return reason ? { kind: 'review', reason } : null
    }
  }
  return null
}

/** A bubble of the burst was sent after this job's trigger (its own job may still be queued to answer the burst). */
export function burstHasLaterBubble(earlier: BurstMessage[], trigger: Pick<BurstTrigger, 'sentAt'>): boolean {
  const triggerAt = at(trigger.sentAt)
  return earlier.some((m) => m.direction === 'inbound' && at(m.sentAt) > triggerAt)
}
