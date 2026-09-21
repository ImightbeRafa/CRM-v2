/**
 * Soft Agent Layer A2 — deterministic pre-model safety router.
 * Payment / media / opt-out must not depend on the model following the prompt.
 */

import { isPaymentSensitiveText } from '@/lib/soft-ai/config'

export const MEDIA_MESSAGE_TYPES = ['image', 'document', 'audio', 'video'] as const
export type MediaMessageType = (typeof MEDIA_MESSAGE_TYPES)[number]

export type SafetyRouteReason = 'payment_or_sinpe' | 'media_inbound' | 'opt_out'

export type SafetyRouteResult =
  | { escalate: false }
  | {
      escalate: true
      reason: SafetyRouteReason
      handoffText: string
    }

const OPT_OUT_RE =
  /\b(no\s+quiero\s+(hablar\s+con\s+)?(un\s+)?bot|hablar\s+con\s+(una\s+)?persona|quiero\s+(un\s+)?humano|atenci[oó]n\s+humana|STOP)\b/i

export const SAFETY_HANDOFF_TEXTS: Record<SafetyRouteReason, string> = {
  payment_or_sinpe:
    'Una persona del equipo te ayuda con el pago / SINPE. En un momento te escriben.',
  media_inbound:
    'Una persona del equipo revisa lo que enviaste y te responde en breve.',
  opt_out:
    'Claro — te paso con una persona del equipo. En un momento te escriben.',
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
 * Deterministic escalate before any model call.
 * Media wins over text cues when messageType is media (no OCR / no guess).
 */
export function routeInboundSafety(input: {
  inboundText: string
  messageType?: string | null
}): SafetyRouteResult {
  if (isMediaMessageType(input.messageType)) {
    return {
      escalate: true,
      reason: 'media_inbound',
      handoffText: SAFETY_HANDOFF_TEXTS.media_inbound,
    }
  }
  if (isPaymentSensitiveText(input.inboundText)) {
    return {
      escalate: true,
      reason: 'payment_or_sinpe',
      handoffText: SAFETY_HANDOFF_TEXTS.payment_or_sinpe,
    }
  }
  if (isOptOutText(input.inboundText)) {
    return {
      escalate: true,
      reason: 'opt_out',
      handoffText: SAFETY_HANDOFF_TEXTS.opt_out,
    }
  }
  return { escalate: false }
}
