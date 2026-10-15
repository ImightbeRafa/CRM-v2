/**
 * Deterministic pre-model safety router.
 * Payment class comes from classifyPaymentText — proof/risk escalates, info questions do not.
 */

import {
  classifyPaymentText,
  hasPaymentWord,
  type PaymentClassification,
} from '@/lib/soft-ai/payment-classifier'
import { reservedShortcutBody } from '@/lib/soft-ai/shortcuts'

export const MEDIA_MESSAGE_TYPES = ['image', 'document', 'audio', 'video'] as const
export type MediaMessageType = (typeof MEDIA_MESSAGE_TYPES)[number]

export type SafetyRouteReason = 'payment_or_sinpe' | 'media_inbound' | 'opt_out'

export type SafetyRouteResult =
  | { escalate: false; paymentClass: PaymentClassification }
  | {
      escalate: true
      reason: SafetyRouteReason
      shortcutKey: 'sys_handoff_media' | 'sys_handoff_payment' | 'sys_handoff_optout'
      handoffText: string
      paymentClass: PaymentClassification
    }

const OPT_OUT_RE =
  // "no quiero una máquina tan grande" is a product question: "máquina" only counts after "hablar con" or
  // "que me atienda"; bare refusals of a bot/robot/IA/asistente virtual still count.
  /\b(no\s+quiero\s+(?:hablar\s+con|que\s+me\s+(?:atienda|responda))\s+(un\s+|una\s+)?(bot|robot|ia|inteligencia\s+artificial|m[aá]quina|asistente\s+virtual)|no\s+quiero\s+(un\s+|una\s+)?(bot|robot|ia|inteligencia\s+artificial|asistente\s+virtual)|hablar\s+con\s+(una\s+)?(persona|humano|alguien|asesor|agente)|quiero\s+(hablar\s+con\s+)?(una\s+persona|un\s+humano|un\s+asesor|un\s+agente|alguien)|atenci[oó]n\s+humana|STOP)\b/i

export const SAFETY_HANDOFF_TEXTS: Record<SafetyRouteReason, string> = {
  payment_or_sinpe: reservedShortcutBody('sys_handoff_payment'),
  media_inbound: reservedShortcutBody('sys_handoff_media'),
  opt_out: reservedShortcutBody('sys_handoff_optout'),
}

export function isMediaMessageType(value: string | null | undefined): value is MediaMessageType {
  return (
    typeof value === 'string' &&
    (MEDIA_MESSAGE_TYPES as readonly string[]).includes(value)
  )
}

// The suggested customer notice says «escriba agente»: a bare word must reach a person deterministically.
const BARE_HANDOFF_RE = /^\s*["'«]?\s*(agente|humano|persona|asesor|agent|human|person)\s*["'».!]*\s*$/i

export function isOptOutText(text: string): boolean {
  return OPT_OUT_RE.test(text || '') || BARE_HANDOFF_RE.test(text || '')
}

/**
 * Media wins over text cues (no OCR). Payment proof/risk and opt-out escalate.
 * payment_info_safe continues so configured facts can answer.
 */
export function routeInboundSafety(input: {
  inboundText: string
  messageType?: string | null
  paymentClass?: PaymentClassification
}): SafetyRouteResult {
  const paymentClass = input.paymentClass ?? classifyPaymentText(input.inboundText)
  if (isMediaMessageType(input.messageType)) {
    return {
      escalate: true,
      reason: 'media_inbound',
      shortcutKey: 'sys_handoff_media',
      handoffText: SAFETY_HANDOFF_TEXTS.media_inbound,
      paymentClass,
    }
  }
  if (paymentClass === 'payment_proof_or_risk') {
    return {
      escalate: true,
      reason: 'payment_or_sinpe',
      shortcutKey: 'sys_handoff_payment',
      handoffText: SAFETY_HANDOFF_TEXTS.payment_or_sinpe,
      paymentClass,
    }
  }
  if (isOptOutText(input.inboundText)) {
    return {
      escalate: true,
      reason: 'opt_out',
      shortcutKey: 'sys_handoff_optout',
      handoffText: SAFETY_HANDOFF_TEXTS.opt_out,
      paymentClass,
    }
  }
  return { escalate: false, paymentClass }
}

/** Webhook placeholders for media without a caption ("[image]", "[sticker]"): not customer words. */
const MEDIA_PLACEHOLDER_RE = /^\s*\[(image|video|audio|voice|document|sticker|imagen|archivo)\]\s*$/i

/**
 * Agentes IA 2.0 (B6). Media never reaches the model (no OCR). It is a receipt — a person checks it, the chat goes to
 * the team — when the sale already gave the payment details (stage esperando_comprobante) or the caption / file name
 * has a payment cue. Anything else (a product photo, an audio, a sticker) gets "¿Me contás por escrito…?" and the
 * chat stays on IA.
 */
export type MediaInboundPlan = 'receipt' | 'ask_in_writing' | null

export function mediaInboundPlan(input: {
  messageType?: string | null
  caption?: string | null
  awaitingReceipt?: boolean
}): MediaInboundPlan {
  // Explicit (B6): a sticker is never a receipt and needs no person; a voice note is an audio.
  if (input.messageType === 'sticker') return 'ask_in_writing'
  if (!isMediaMessageType(input.messageType) && input.messageType !== 'voice') return null
  const caption = MEDIA_PLACEHOLDER_RE.test(input.caption || '') ? '' : (input.caption || '')
  if (input.awaitingReceipt) return 'receipt'
  if (caption && (hasPaymentWord(caption) || classifyPaymentText(caption) !== 'non_payment')) return 'receipt'
  return 'ask_in_writing'
}
