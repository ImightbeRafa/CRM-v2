/**
 * Structured webhook log fields for chat Meta inbox (Respond.io Phase 4).
 */

export type ChatWebhookEventResult =
  | 'stored'
  | 'duplicate'
  | 'skipped'
  | 'receipt_updated'
  | 'receipt_noop'
  | 'invalid_signature'
  | 'error'
  | 'ok'

export type ChatWebhookObsFields = {
  socialAccountId: string | null
  durationMs: number
  result: ChatWebhookEventResult
  platform?: string | null
  providerMessageId?: string | null
  conversationId?: string | null
  messageId?: string | null
  reason?: string | null
}

export function buildChatWebhookObsFields(
  partial: Partial<ChatWebhookObsFields> & {
    durationMs: number
    result: ChatWebhookEventResult
  },
): ChatWebhookObsFields {
  return {
    socialAccountId: partial.socialAccountId ?? null,
    durationMs: partial.durationMs,
    result: partial.result,
    platform: partial.platform ?? null,
    providerMessageId: partial.providerMessageId ?? null,
    conversationId: partial.conversationId ?? null,
    messageId: partial.messageId ?? null,
    reason: partial.reason ?? null,
  }
}

export function logChatWebhookEvent(
  label: string,
  fields: ChatWebhookObsFields,
  extra?: Record<string, unknown>,
): void {
  console.log(label, {
    socialAccountId: fields.socialAccountId,
    durationMs: fields.durationMs,
    result: fields.result,
    ...(fields.platform ? { platform: fields.platform } : {}),
    ...(fields.providerMessageId ? { providerMessageId: fields.providerMessageId } : {}),
    ...(fields.conversationId ? { conversationId: fields.conversationId } : {}),
    ...(fields.messageId ? { messageId: fields.messageId } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(extra || {}),
  })
}
