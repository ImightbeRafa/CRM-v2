/**
 * Deterministic pre-model safety router.
 * Payment class comes from classifyPaymentText — proof/risk escalates, info questions do not.
 */

import {
  classifyPaymentText,
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
  /\b(no\s+quiero\s+(hablar\s+con\s+)?(un\s+)?bot|hablar\s+con\s+(una\s+)?persona|quiero\s+(un\s+)?humano|atenci[oó]n\s+humana|STOP)\b/i

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

export function isOptOutText(text: string): boolean {
  return OPT_OUT_RE.test(text || '')
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
