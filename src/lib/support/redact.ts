/**
 * Redaction applied to everything that leaves Betsy for the support agent
 * (webhook push, poll fallback, MCP tool output). Ported from Advance
 * `api/lib/mcp/admin-tools.ts` and extended with card numbers / JWTs / keys.
 * Pure module.
 */

/** `cliente@ejemplo.com` → `c*****e@ejemplo.com`. Non-emails → null. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null
  const at = email.lastIndexOf('@')
  if (at < 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!domain) return null
  const masked =
    local.length <= 2
      ? `${local[0]}*`
      : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}`
  return `${masked}@${domain}`
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

function luhnOk(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

export type RedactOptions = {
  /** Replace e-mail addresses inside free text (default true). */
  emails?: boolean
}

/**
 * Removes credentials and payment data from free text: bearer tokens,
 * `key=value` secrets, JWTs, provider keys (sk-, xai-, re_, ghp_…), card
 * numbers (Luhn-valid 13–19 digits), CVV mentions and, by default, emails.
 */
export function redactSecrets(text: string | null | undefined, opts: RedactOptions = {}): string {
  if (!text) return ''
  let out = String(text)
    .replace(/(authorization:\s*)bearer\s+\S+/gi, '$1Bearer [REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|contrase(?:ñ|n)a|clave|pin)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:sk|pk|rk|xai|re|ghp|gho|github_pat|whsec|EAA[A-Za-z0-9]*)[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (match) => {
      const digits = match.replace(/\D/g, '')
      return digits.length >= 13 && digits.length <= 19 && luhnOk(digits) ? '[REDACTED_CARD]' : match
    })
    .replace(/\b(cvv|cvc|cvv2)\s*[:=]?\s*\d{3,4}\b/gi, '$1 [REDACTED]')
  if (opts.emails !== false) out = out.replace(EMAIL_RE, '[REDACTED_EMAIL]')
  return out
}

/** Keeps origin + path only; drops query and fragment (tokens often live there). */
export function scrubPageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim().slice(0, 2000)
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('/')) return trimmed.split(/[?#]/)[0] || '/'
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return null
  }
}

/** Truncate to `max` chars, appending an ellipsis when cut. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}
