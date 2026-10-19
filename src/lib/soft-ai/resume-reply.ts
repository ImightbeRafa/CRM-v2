/**
 * "Devolver a IA" and the periodic waiting sweep share this gate.
 * A courtesy ("Muchas gracias!!") or a payment the team already has is not a new question.
 * A real unanswered question still gets a reply. The live webhook path does not use this.
 */
import { classifyPaymentText, hasHardPaymentClaim, isCourtesyText } from '@/lib/soft-ai/payment-classifier'

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker'])

export type SweepSkipReason = 'courtesy' | 'empty' | 'payment_already_with_staff' | 'receipt_media'

export type SweepAnswer =
  | { answer: true; reason: 'needs_reply' }
  | { answer: false; reason: SweepSkipReason }

/** "ya hice el sinpe" counts; "ya le hago el sinpe" is still a question about paying. */
function sinpeAlreadyDone(text: string): boolean {
  if (/[?¿]/.test(text)) return false
  if (!/\bya\b/iu.test(text) || !/\bsinpe\b/iu.test(text)) return false
  if (/\b(?:hago|har[eé]|voy\s+a|vamos\s+a|puedo\s+hacer)\b/iu.test(text)) return false
  return true
}

export function sweepShouldAnswer(message: { content?: string | null; messageType?: string | null }): SweepAnswer {
  const content = (message.content || '').trim()
  const type = (message.messageType || 'text').toLowerCase()
  const media = MEDIA_TYPES.has(type)
  if (!content && !media) return { answer: false, reason: 'empty' }
  if (content && isCourtesyText(content)) return { answer: false, reason: 'courtesy' }
  const stillGoingToPay = /\b(?:hago|har[eé]|voy\s+a|vamos\s+a|puedo\s+hacer)\b/iu.test(content)
  if (
    content &&
    !stillGoingToPay &&
    (hasHardPaymentClaim(content) ||
      classifyPaymentText(content) === 'payment_proof_or_risk' ||
      sinpeAlreadyDone(content))
  ) {
    return { answer: false, reason: 'payment_already_with_staff' }
  }
  if (media && !/[?¿]/.test(content)) return { answer: false, reason: 'receipt_media' }
  return { answer: true, reason: 'needs_reply' }
}
