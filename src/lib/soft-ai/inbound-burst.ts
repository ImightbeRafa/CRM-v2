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
 * Pure: no DB, no clock except the `now` argument.
 */

import { isOptOutText, mediaInboundPlan } from '@/lib/soft-ai/llm/safety-router'
import { HANDOFF_REASON, type TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'

/** A running job yields to a newer burst job only while its trigger is this young (no starvation on a long chat). */
export const BURST_YIELD_MAX_AGE_MS = 60_000
/** Earlier customer bubbles count as the same burst when sent this close before the trigger (and still unanswered). */
export const BURST_WINDOW_MS = 2 * 60_000

const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video', 'voice', 'sticker'])
const PLACEHOLDER_RE = /^\s*\[(image|video|audio|voice|document|sticker|imagen|archivo)\]\s*$/i

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
  /** A photo / file / audio in the burst still needs a person to look (review hand-off after the reply). */
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
 * The customer's earlier bubbles of this burst, oldest first: inbound, after the store last wrote, sent no later than
 * the trigger and at most BURST_WINDOW_MS before it. (History never holds the trigger itself.)
 */
export function unansweredBurst(history: BurstMessage[], trigger: Pick<BurstTrigger, 'sentAt'>): BurstMessage[] {
  const triggerAt = at(trigger.sentAt)
  const out: BurstMessage[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    const sent = at(m.sentAt)
    if (sent > triggerAt) continue
    if (m.direction === 'outbound') break
    if (triggerAt - sent > BURST_WINDOW_MS) break
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
  const earlierInbound = input.earlier.filter((m) => m.direction === 'inbound')
  const earlierMedia = earlierInbound.filter((m) => isMedia(m.messageType))
  const earlierTexts = earlierInbound.filter((m) => !isMedia(m.messageType) && realText(m.content))
  if (!earlierInbound.length) return single

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
  const earlierReceipt = [...earlierMedia].reverse().find(receiptOf)
  if (earlierReceipt) {
    return {
      inboundText: earlierReceipt.content || '',
      messageType: earlierReceipt.messageType || 'image',
      mediaReview: false,
      reason: 'burst_receipt',
    }
  }

  const reviewMedia = [...earlierMedia, ...(isMedia(triggerType) ? [input.trigger] : [])].some(
    (m) => m.messageType !== 'sticker',
  )

  if (isMedia(triggerType)) {
    // "Que costo tiene" + photo: answer the text, a person still looks at the photo.
    const lastText = earlierTexts[earlierTexts.length - 1]
    if (!lastText) return single
    return {
      inboundText: realText(lastText.content),
      messageType: 'text',
      mediaReview: reviewMedia,
      reason: 'media_with_text',
    }
  }

  // Photo + "¿cuánto cuesta?": the text is answered as usual, a person still looks at the photo.
  if (earlierMedia.length) {
    return { ...single, mediaReview: reviewMedia, reason: 'text_with_media' }
  }
  return single
}

/**
 * The reply's hand-off once the burst's media is counted: a planned hand-off (payment, review, …) stays as it is;
 * otherwise media in the burst asks a person to look (review: the chat stays on IA, the text is unchanged).
 */
export function withBurstMediaReview(handoff: TurnHandoff | null, mediaReview: boolean): TurnHandoff | null {
  if (handoff || !mediaReview) return handoff
  return { kind: 'review', reason: HANDOFF_REASON.review }
}
