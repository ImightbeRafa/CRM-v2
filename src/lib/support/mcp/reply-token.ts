/**
 * Per-ticket write capability for the support agent (SecureDog DATA-S1 d). Pure.
 *
 * The webhook push / poll / notification email for a ticket carry `betsy.reply_token` =
 * HMAC(SUPPORT_MCP_TOKEN, "reply:" + ticketId). MCP write tools (support_reply,
 * support_update_ticket, support_escalate) require it, and no MCP read tool ever returns it, so
 * instructions hidden in ticket A cannot make the agent write to ticket B.
 * Rotating SUPPORT_MCP_TOKEN invalidates all outstanding tokens.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupportEventPayload } from '../events'

export function replyToken(ticketId: string, secret: string): string {
  return createHmac('sha256', secret).update(`reply:${ticketId}`).digest('base64url').slice(0, 32)
}

export function verifyReplyToken(ticketId: string, token: unknown, secret: string | undefined): boolean {
  const key = (secret || '').trim()
  if (!key || typeof token !== 'string' || token.length !== 32) return false
  const a = Buffer.from(replyToken(ticketId, key))
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Adds the token at delivery time (never stored in the DB payload). No MCP token → unchanged. */
export function withReplyToken(payload: SupportEventPayload, secret: string | undefined): SupportEventPayload {
  const key = (secret || '').trim()
  if (!key) return payload
  return { ...payload, betsy: { ...payload.betsy, reply_token: replyToken(payload.ticket.id, key) } }
}
