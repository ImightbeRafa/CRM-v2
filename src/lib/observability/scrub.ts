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
  // Database error details echo whole rows (names, addresses, notes).
  [/Failing row contains \([^)]*\)?/g, 'Failing row contains ([redacted])'],
  [/DETAIL:[^\n]*/g, 'DETAIL: [redacted]'],
  [/Key \(([^)]{1,80})\)=\([^)]*\)/g, 'Key ($1)=([redacted])'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{1,4096}/gi, 'Bearer [redacted]'],
  [/\b(access_token|refresh_token|client_secret|appsecret_proof|password|secret)=([^&\s"']{1,4096})/gi, '$1=[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}\b/g, '[jwt]'],
  [/(postgres(?:ql)?:\/\/)[^\s'"]{1,2048}/gi, '$1[redacted]'],
  // Bounded on both sides (an unbounded local part was quadratic on long strings).
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g, '[email]'],
  [/\b[a-f0-9]{32,4096}\b/gi, '[hex]'],
  [/\b[A-Za-z0-9+/_-]{40,4096}={0,2}/g, '[secret]'],
  // Phones / ids: 7+ digits, optionally with spaces or dashes between groups.
  [/\+?\d[\d\s-]{5,40}\d/g, '[number]'],
]

/** Never scrub more than this (regex cost); callers store far less anyway. */
export const SCRUB_INPUT_MAX = 12_000

/**
 * Prisma validation errors print every argument of the failed call (customer names, addresses,
 * notes). Keep only the headline and the lines that say what was wrong.
 */
export function reducePrismaMessage(value: string): string {
  if (!/Invalid `[^`]{1,200}` invocation/.test(value)) return value
  const lines = value.split('\n').map((l) => l.trim())
  const keep = lines.filter((l) => /^(Invalid `|Argument `|Unknown argument|Unknown field|Missing|Unique constraint|Foreign key|The column|The table|Null constraint|Value too long)/.test(l))
  return keep.length ? keep.join('\n') : lines[0] ?? ''
}

/** Removes NUL / control characters (Postgres rejects NUL) and broken surrogate pairs. */
export function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  const wf = (stripped as string & { toWellFormed?: () => string }).toWellFormed
  return typeof wf === 'function' ? wf.call(stripped) : stripped.replace(/[\ud800-\udfff]/g, '�')
}

export function scrubPii(value: string): string {
  let out = scrubTokens(reducePrismaMessage(cleanText(String(value).slice(0, SCRUB_INPUT_MAX))))
  for (const [pattern, replacement] of PII_PATTERNS) out = out.replace(pattern, replacement)
  return out
}
