/**
 * Per-ticket write capability for the support agent (SecureDog DATA-S1 d / R3). Pure.
 *
 * The webhook push / poll / notification email for a ticket carry `betsy.reply_token`; MCP write tools
 * (support_reply, support_update_ticket, support_escalate) require it, and no MCP read tool returns it, so
 * instructions hidden in ticket A cannot make the agent write to ticket B.
 *  - Signed with a key only the server has (derived from NEXTAUTH_SECRET with its own label), NOT the
 *    MCP bearer the agent holds: a leaked bearer allows reads, never writes.
 *  - Expires 72 h after delivery, so tokens piling up in the support mailbox go stale.
 * Format: `<expiry unix seconds, base36>.<hmac 32 chars>`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupportEventPayload } from '../events'

export const REPLY_TOKEN_TTL_SECONDS = 72 * 60 * 60

function signingKey(serverSecret: string): Buffer {
  return createHmac('sha256', serverSecret).update('betsy-support-reply-token-v1').digest()
}

function mac(ticketId: string, exp: string, serverSecret: string): string {
  return createHmac('sha256', signingKey(serverSecret)).update(`reply:${ticketId}:${exp}`).digest('base64url').slice(0, 32)
}

export function replyToken(ticketId: string, serverSecret: string, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000 + REPLY_TOKEN_TTL_SECONDS).toString(36)
  return `${exp}.${mac(ticketId, exp, serverSecret)}`
}

export function verifyReplyToken(
  ticketId: string,
  token: unknown,
  serverSecret: string | undefined,
  now: Date = new Date(),
): boolean {
  const key = (serverSecret || '').trim()
  if (!key || typeof token !== 'string' || token.length > 64) return false
  const m = /^([0-9a-z]{1,10})\.([A-Za-z0-9_-]{32})$/.exec(token)
  if (!m) return false
  if (parseInt(m[1], 36) * 1000 < now.getTime()) return false
  const a = Buffer.from(mac(ticketId, m[1], key))
  const b = Buffer.from(m[2])
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Adds the token at delivery time (never stored in the DB payload). No server secret → unchanged. */
export function withReplyToken(payload: SupportEventPayload, serverSecret: string | undefined, now?: Date): SupportEventPayload {
  const key = (serverSecret || '').trim()
  if (!key) return payload
  return { ...payload, betsy: { ...payload.betsy, reply_token: replyToken(payload.ticket.id, key, now) } }
}
