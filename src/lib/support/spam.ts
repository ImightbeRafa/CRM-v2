/**
 * Spam heuristics for the public contact form (SPEC §9). Pure.
 * Turnstile is verified by the route with the shared `src/lib/turnstile.ts`
 * (same keys as signup; off unless both keys are set).
 *
 * Verdicts:
 *  - `reject`  → honeypot filled / submitted too fast: answer 200, store nothing.
 *  - `spam`    → stored with status `spam`, no webhook, no email.
 *  - `ok`      → normal ticket.
 */
import { createHash } from 'node:crypto'

export const MIN_FILL_MS = 3000
export const MAX_LINKS = 3

export type SpamInput = {
  honeypot?: unknown
  startedAt?: unknown
  subject: string
  body: string
  now?: number
}

export type SpamVerdict = { verdict: 'ok' | 'spam' | 'reject'; reasons: string[] }

export function countLinks(text: string): number {
  return (text.match(/\b(?:https?:\/\/|www\.)\S+/gi) || []).length
}

export function checkSpam(input: SpamInput): SpamVerdict {
  const now = input.now ?? Date.now()
  if (typeof input.honeypot === 'string' && input.honeypot.trim() !== '') {
    return { verdict: 'reject', reasons: ['honeypot'] }
  }
  const started = Number(input.startedAt)
  if (Number.isFinite(started) && started > 0) {
    if (now - started < MIN_FILL_MS) return { verdict: 'reject', reasons: ['too_fast'] }
  } else {
    // Old clients (and /api/contact callers) do not send startedAt: allowed, but noted.
  }
  const reasons: string[] = []
  const text = `${input.subject}\n${input.body}`
  if (countLinks(text) > MAX_LINKS) reasons.push('too_many_links')
  if (/<a\s+href=|\[url=/i.test(text)) reasons.push('markup_links')
  if (/(.)\1{30,}/.test(text)) reasons.push('repeated_chars')
  return reasons.length ? { verdict: 'spam', reasons } : { verdict: 'ok', reasons: [] }
}

/** sha256(salt + ip), hex, first 32 chars. Never store the raw IP. */
export function hashIp(ip: string | null | undefined, salt: string | undefined): string | null {
  if (!ip || ip === 'unknown' || !salt) return null
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}

/** Strips CR/LF/tab and angle brackets (header injection in email subjects). */
export function sanitizeHeaderText(text: string, max = 200): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max)
}
