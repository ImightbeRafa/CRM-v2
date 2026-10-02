/**
 * Privacy scrubbing for error reports (Betsy's own error tracking, replaced Sentry 2026-10-02).
 * No imports: safe in the browser, Node and edge.
 *
 * - One-time tokens (reset / verification / invite links) never leave in a URL, raw or URL-encoded.
 * - scrubPii: emails, phone-like digit runs, bearer tokens, JWTs, long hex / base64 secrets and
 *   Postgres "Key (col)=(value)" details are masked before anything is logged or stored.
 */
// Backslash excluded too: inside JSON a token may be followed by an escape (\" or \), which the
// match must not swallow (the result would stop being valid JSON).
const RAW = /([?&#](?:token|code)=)[^&#\s"'\\]+/gi
const ENCODED = /((?:%3F|%26|%23)(?:token|code)%3D)[^&#\s"'%\\]+(?:%[0-9A-F]{2}[^&#\s"'%\\]*)*/gi

export function scrubTokens(value: string): string {
  return value.replace(RAW, '$1[redacted]').replace(ENCODED, '$1[redacted]')
}

/** Scrubbed copy, or null (drop the event) when it cannot be scrubbed safely — fail closed. */
export function scrubEvent<T>(event: T): T | null {
  if (event == null) return event
  try {
    return JSON.parse(scrubTokens(JSON.stringify(event))) as T
  } catch {
    return null
  }
}

const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[jwt]'],
  [/(postgres(?:ql)?:\/\/)[^\s'"]+/gi, '$1[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/Key \(([^)]{1,80})\)=\([^)]*\)/g, 'Key ($1)=([redacted])'],
  [/\b[a-f0-9]{32,}\b/gi, '[hex]'],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, '[secret]'],
  // Phones / ids: 7+ digits, optionally with spaces or dashes between groups.
  [/\+?\d[\d\s-]{5,}\d/g, '[number]'],
]

export function scrubPii(value: string): string {
  let out = scrubTokens(value)
  for (const [pattern, replacement] of PII_PATTERNS) out = out.replace(pattern, replacement)
  return out
}
