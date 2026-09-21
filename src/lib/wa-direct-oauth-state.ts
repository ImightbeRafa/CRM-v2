import { timingSafeEqual } from 'crypto'

export const WA_DIRECT_OAUTH_STATE_COOKIE = 'wa_direct_oauth_state'

/** Timing-safe compare for WhatsApp direct-oauth CSRF state. */
export function isValidWaDirectOauthState(
  provided: string,
  stored: string,
): boolean {
  if (!provided || !stored) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(stored)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
