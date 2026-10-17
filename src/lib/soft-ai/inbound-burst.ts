/**
 * Burst = one reply (2026-10-17, PatchHouse Instagram).
 *
 * A customer often sends 2–3 bubbles within seconds: an ad share + "¡Hola! Quiero más información.", or "Que costo
 * tiene" + a photo. The queue holds the older jobs back while a newer one settles (automation-queue BURST_SETTLE_MS);
 * a job that is already running yields to a newer one before the model and right before the send. The newest job then
 * answers the whole unanswered burst — so it must judge EVERY unanswered bubble as if it still had its own job:
 * - planBurstInbound: what the turn answers when media and text mix (receipt path kept; text answered + photo review);
 * - resolveBurstDecision: a TRUE hand-off in any bubble wins; a question that needs the model is never dropped
 *   because the newest bubble got a code reply; a review another bubble owes is kept (burstReviewFor);
 * - burstOptOut: a "STOP" in any bubble keeps the later waiting ack silent (Verifier F7).
 * Pure: no DB, no clock except the `now` argument.
 */

import { isOptOutText, mediaInboundPlan } from '@/lib/soft-ai/llm/safety-router'
import { isOptOutText as isWaitingOptOutText } from '@/lib/soft-ai/waiting-ack'
import type { TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'

/** A running job yields to a newer burst job only while its trigger is this young (no starvation on a long chat). */
export const BURST_YIELD_MAX_AGE_MS = 60_000

const MEDIA_TYPES = new Set(['image', 'document', 'audio', 'video', 'voice', 'sticker'])
/**
 * The webhook's own bubble tokens (meta-chat.ts: WhatsApp `[${type}]`, Instagram attachment types) — not customer
 * text. Lowercase and listed on purpose: "[STOP]" or "[urgente]" typed by a customer stays text (SecureDog MEDIA).
 */
const PLACEHOLDER_RE =
  /^\s*\[(image|imagen|video|audio|voice|document|archivo|file|attachment|sticker|location|contact|contacts|share|story_mention|ig_reel|reel|ig_post|ig_story|reaction|unsupported|button|interactive|order|system|template|fallback|request_welcome|unknown)\]\s*$/
/** A WhatsApp document's caption falls back to its file name ("IMG-2026.pdf"): that is not something the customer said. */
const FILE_NAME_RE = /^[\p{L}\d _.()-]{1,120}\.(pdf|jpe?g|png|gif|webp|heic|docx?|xlsx?|pptx?|txt|csv|mp4|mov|mp3|ogg|opus|m4a|zip)$/iu

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

type BurstDecisionLike = { handled: boolean; handoff: TurnHandoff | null; shortcutKey: string | null }

function isMedia(type: string | null | undefined): boolean {
  return MEDIA_TYPES.has(type || '')
}

function realText(content: string | null | undefined): string {
  const text = (content || '').trim()
  return PLACEHOLDER_RE.test(text) || FILE_NAME_RE.test(text) ? '' : text
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
 * The customer's other unanswered bubbles, oldest first: every inbound after the store's LAST reply (wherever it sits,
 * also after the trigger: what it answered is not answered again). No time window (SecureDog INT): the newest job
 * answers for every bubble whose job it superseded, however long the customer kept typing. History never holds the
 * trigger; the loaded history window (24 rows) is the only bound.
 */
export function unansweredBurst(history: BurstMessage[], _trigger?: Pick<BurstTrigger, 'sentAt'>): BurstMessage[] {
  const out: BurstMessage[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.direction === 'outbound') break
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
 * Every bubble of the burst on its own, with its own message type, unless it IS the planned text: each is decided as
 * if it still had its own job. A bubble that only appears joined in the planned text ("agente" + photo captioned
 * "mire esto" → "agente\nmire esto") is still checked alone (SecureDog MEDIA: the bare "agente" hand-off), and so is
 * the newest photo's caption.
 */
export function burstOtherTexts(
  earlier: BurstMessage[],
  plan: Pick<BurstInboundPlan, 'inboundText'>,
  trigger?: Pick<BurstTrigger, 'content' | 'messageType'>,
): Array<{ text: string; messageType: string }> {
  const planned = plan.inboundText.trim()
  const bubbles = earlier
    .filter((m) => m.direction === 'inbound' && m.messageType !== 'sticker')
    .map((m) => ({ text: realText(m.content), messageType: m.messageType || 'text' }))
  if (trigger && isMedia(trigger.messageType) && trigger.messageType !== 'sticker') {
    bubbles.push({ text: realText(trigger.content), messageType: trigger.messageType || 'image' })
  }
  return bubbles.filter((m) => m.text && m.text !== planned)
}

/**
 * The burst's decision:
 * - a TRUE hand-off in the planned text wins; else a TRUE hand-off in any other bubble wins (opt-out, payment claim,
 *   a hand-off keyword reply) — as when it had its own job;
 * - else, when the planned text got a code reply but another bubble needs the model ("Quiero 2 del kit con envío a
 *   Limón" + "¿Cómo pago?"), the model answers the whole burst (`toModel`) and the code reply's own review is kept.
 */
export function resolveBurstDecision<T extends BurstDecisionLike>(
  main: T,
  others: Array<{ text: string; decision: T }>,
  toModel: (decision: T) => T,
): { decision: T; carriedReview: TurnHandoff | null } {
  if (main.handled && main.handoff?.kind === 'handoff') return { decision: main, carriedReview: null }
  const otherHandoff = others.find((o) => o.decision.handled && o.decision.handoff?.kind === 'handoff')
  if (otherHandoff) return { decision: otherHandoff.decision, carriedReview: null }
  // A greeting / thanks bubble ("Hola" + "¿Cómo pago?") asks nothing: the code reply stays. Another bubble that needs
  // the model — or got a DIFFERENT code reply of its own ("¿Cómo pago?" + an owner's "precio" saved reply, Verifier
  // r4 #1) — would be dropped by one code reply: the model answers the whole burst instead.
  const unansweredByMain = (o: { text: string; decision: T }) =>
    !isCourtesyOnly(o.text) &&
    (!o.decision.handled ||
      (o.decision.handoff?.kind !== 'handoff' &&
        o.decision.shortcutKey !== main.shortcutKey &&
        o.decision.shortcutKey !== 'sys_media_ask'))
  if (main.handled && others.some(unansweredByMain)) {
    const carried = main.handoff?.kind === 'review' && main.shortcutKey !== 'sys_media_ask' ? main.handoff : null
    return { decision: toModel(main), carriedReview: carried }
  }
  return { decision: main, carriedReview: null }
}

const COURTESY_WORD = String.raw`(?:hol+a+|holis?|buenas|buen[oa]?s?\s+(?:d[ií]as?|tardes|noches)|hey|saludos|pura\s+vida|upe|diay|(?:muchas\s+|mil\s+)?gracias|ok|okay|okey|ah\s+ok|ah\s+bueno|bueno|claro|dale|perfecto|genial|excelente|listo|s[ií]|por\s+favor|porfa|ja(?:ja)+|je(?:je)+|(?:c[oó]mo|qu[eé])\s+(?:est[aá]s?|est[aá]n|tal)|todo\s+bien)`
const COURTESY_RE = new RegExp(String.raw`^(?:[\s,.!¡¿?\p{Extended_Pictographic}️]|${COURTESY_WORD}(?![\p{L}\d]))+$`, 'iu')

/** "Hola", "¡Buenas tardes!", "gracias 🙏", "ok": a bubble that asks nothing. */
export function isCourtesyOnly(text: string): boolean {
  const t = (text || '').trim()
  return t.length > 0 && t.length <= 60 && COURTESY_RE.test(t)
}

/**
 * The review a person still owes the burst after the reply (the chat stays on IA), when the turn plans no hand-off of
 * its own: the planned code reply's review that went to the model (carried), a review another bubble would have
 * raised on its own job ("¿Cómo pago?" where the store sends the payment data by hand → payment_details), else the
 * burst's photo / audio (review). "¿Me contás por escrito…?" of a photo is the media review itself.
 */
export function burstReviewFor<T extends BurstDecisionLike>(input: {
  decision: T
  others: Array<{ decision: T }>
  mediaReview: boolean
  carried?: TurnHandoff | null
}): TurnHandoff | null {
  if (input.decision.handoff) return null
  if (input.carried) return { kind: 'review', reason: input.carried.reason }
  const other = input.others
    .map((o) => o.decision)
    .find((d) => d !== input.decision && d.handled && d.handoff?.kind === 'review' && d.shortcutKey !== 'sys_media_ask')
  if (other?.handoff) return { kind: 'review', reason: other.handoff.reason }
  return input.mediaReview ? { kind: 'review', reason: 'review' } : null
}

/** A "STOP" / "no me escriban más" in ANY bubble of the burst (trigger, other texts, captions): no later waiting ack. */
export function burstOptOut(trigger: Pick<BurstTrigger, 'content'>, earlier: BurstMessage[]): boolean {
  return [trigger.content, ...earlier.filter((m) => m.direction === 'inbound').map((m) => m.content)].some((t) =>
    isWaitingOptOutText(t),
  )
}

const BURST_REVIEW_PREFIX = 'review:'

/** The decision-trace step that records the burst plan, its owed review (lease reclaim) and an opt-out (waiting ack). */
export function burstTraceStep(plan: Pick<BurstInboundPlan, 'reason'>, review: TurnHandoff | null, optOut = false) {
  return {
    step: 'burst',
    outcome: plan.reason,
    ...(review ? { reason: `${BURST_REVIEW_PREFIX}${review.reason}` } : {}),
    ...(optOut ? { optOut: true } : {}),
  }
}

function burstStepIn(trace: unknown): Record<string, unknown> | null {
  if (!trace || typeof trace !== 'object') return null
  const steps = (trace as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return null
  for (const s of steps) {
    if (s && typeof s === 'object' && (s as Record<string, unknown>).step === 'burst') return s as Record<string, unknown>
  }
  return null
}

/** The burst review a turn's decision trace planned (lease reclaim), or null. */
export function burstReviewIn(trace: unknown): TurnHandoff | null {
  const step = burstStepIn(trace)
  if (!step || typeof step.reason !== 'string' || !step.reason.startsWith(BURST_REVIEW_PREFIX)) return null
  const reason = step.reason.slice(BURST_REVIEW_PREFIX.length)
  return reason ? { kind: 'review', reason } : null
}

/** Did the turn's burst hold an opt-out ("STOP" + "por favor")? The waiting ack then stays silent. */
export function burstOptOutIn(trace: unknown): boolean {
  return burstStepIn(trace)?.optOut === true
}

/** A bubble of the burst was sent after this job's trigger (its own job may still be queued to answer the burst). */
export function burstHasLaterBubble(earlier: BurstMessage[], trigger: Pick<BurstTrigger, 'sentAt'>): boolean {
  const triggerAt = at(trigger.sentAt)
  if (!Number.isFinite(triggerAt)) return false
  return earlier.some((m) => m.direction === 'inbound' && at(m.sentAt) > triggerAt)
}
