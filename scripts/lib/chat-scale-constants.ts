/** Deterministic IDs / counts for chat Phase 4 scale seed + bench. */

export const SCALE_TENANT_ID = 'scale_tenant_chat_phase4'
export const SCALE_USER_ID = 'scale_user_chat_phase4'
export const SCALE_TENANT_SLUG = 'chat-scale-phase4'
export const SCALE_USER_EMAIL = 'chat-scale-phase4@localhost.invalid'

export const ACCOUNT_COUNT = 5
export const CONVERSATION_COUNT = 2000
export const MESSAGE_COUNT = 50_000
export const HEAVY_THREAD_MESSAGES = 3000

export function scaleAccountId(i: number): string {
  return `scale_sa_${String(i + 1).padStart(4, '0')}`
}

export function scaleConversationId(i: number): string {
  return `scale_conv_${String(i + 1).padStart(7, '0')}`
}

export function scaleMessageId(i: number): string {
  return `scale_msg_${String(i + 1).padStart(8, '0')}`
}

export function scalePeerId(i: number): string {
  return `peer_${String(i + 1).padStart(7, '0')}`
}

export function scaleProviderMessageId(i: number): string {
  return `wamid.scale.${String(i + 1).padStart(8, '0')}`
}
