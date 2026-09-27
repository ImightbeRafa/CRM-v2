/**
 * Post-login return path validation (open-redirect guard).
 *
 * Pure and DOM-free so it can be unit-tested. Returns a same-origin relative
 * path (`/path?query#hash`) or the fallback — never an absolute URL, never a
 * protocol-relative one, never an auth/api/_next path (redirect loops).
 */
export const DEFAULT_RETURN_PATH = '/dashboard'

const MAX_LENGTH = 2048
const MAX_DECODE_ROUNDS = 3
const CONTROL_CHARS = /[\x00-\x1f\x7f]/
const SCHEME_LIKE = /^\/*[a-z][a-z0-9+.-]*:/i
const PLACEHOLDER_ORIGIN = 'https://return.invalid'
const BLOCKED_PREFIXES = ['/auth', '/api', '/_next']

function isSafeForm(value: string): boolean {
  if (!value.startsWith('/')) return false
  if (value.startsWith('//')) return false
  if (value.includes('\\')) return false
  if (CONTROL_CHARS.test(value)) return false
  if (SCHEME_LIKE.test(value)) return false
  return true
}

function isBlockedPath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  return BLOCKED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))
}

export function safeReturnPath(
  raw: unknown,
  opts?: { origin?: string; fallback?: string },
): string {
  const fallback = opts?.fallback ?? DEFAULT_RETURN_PATH
  if (typeof raw !== 'string') return fallback
  let value = raw.trim()
  if (!value || value.length > MAX_LENGTH) return fallback

  // Absolute URL of our own origin -> reduce to path+search+hash.
  if (opts?.origin && /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const parsed = new URL(value)
      if (parsed.origin !== opts.origin) return fallback
      value = `${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
      return fallback
    }
  }

  if (CONTROL_CHARS.test(value) || value.includes('\\')) return fallback

  const forms: string[] = [value]
  let current = value
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return fallback
    }
    if (decoded === current) break
    forms.push(decoded)
    current = decoded
  }
  if (!forms.every(isSafeForm)) return fallback

  let parsed: URL
  try {
    parsed = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return fallback
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return fallback
  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`
  if (normalized.startsWith('//') || normalized.startsWith('/\\')) return fallback
  if (!isSafeForm(normalized)) return fallback

  const pathForms = [parsed.pathname, ...forms.map((f) => f.split(/[?#]/)[0])]
  if (pathForms.some(isBlockedPath)) return fallback

  return normalized
}
