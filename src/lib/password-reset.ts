/**
 * Password reset tokens (security, 2026-09-28). The email carries a random 256-bit token; the
 * database only stores its SHA-256, so a leaked DB row cannot be used to take over an account.
 */
import crypto from 'crypto'

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Links sent before the switch stored the raw UUID. They stay valid until they expire (≤ 1 h), but
 * only UUID-shaped input is compared raw — a stolen 64-hex hash can never be replayed as a token.
 * Remove after 2026-10-05.
 */
export function legacyRawResetToken(token: string): string | null {
  return UUID.test(token) ? token : null
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
