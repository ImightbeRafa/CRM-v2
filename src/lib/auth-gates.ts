/**
 * Credentials login gates (security, 2026-09-28): email verification for new accounts, failed-login
 * lockout, and constant-ish timing for unknown emails. Every gate is designed so that no existing
 * user can be locked out by the deploy itself:
 *
 * - Email verification is OFF until `EMAIL_VERIFICATION_ENFORCE_FROM` (ISO date) is set, and then
 *   only applies to accounts created at/after that instant. Existing unverified users are exempt by
 *   construction. Recovery: resend the verification email, or reset the password (verifies).
 * - Lockout is time-based only (no DB state). Every attempt is RESERVED atomically before bcrypt
 *   (parallel guesses cannot slip past a read-then-write check) and a correct password gives it
 *   back. Limits per 15 min: 5 per email+IP, 30 per IP bucket (IPv6 /48), 40 per email across all
 *   IPs (botnet / IPv6 rotation). The per-email cap can be abused to lock an account for 15 min;
 *   the owner's way back is a password reset, which clears it. Kill switch:
 *   `AUTH_LOCKOUT_DISABLED=1`.
 * - Failures for emails that do not exist are counted too, so a lock reveals nothing.
 */
import { normalizeClientIp, clearFailures, recordFailure, releaseAttempt, rightmostForwarded } from '@/lib/rate-limit'
import { hashPassword, verifyPassword } from '@/lib/password'

export const LOGIN_ERRORS = {
  emailNotVerified: 'EMAIL_NOT_VERIFIED',
  locked: 'LOCKED',
} as const

const WINDOW_MS = 15 * 60 * 1000
export const LOCKOUT = {
  emailIpMax: 5,
  ipMax: 30,
  emailMax: 40,
  windowMs: WINDOW_MS,
} as const

export function parseEnforceFrom(raw: string | undefined | null): Date | null {
  if (!raw || !raw.trim()) return null
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? null : d
}

/** True only for an unverified account created at/after the configured cutoff. */
export function emailVerificationBlocks(
  user: { emailVerified: Date | string | null; createdAt: Date | string | null },
  enforceFrom: Date | null = parseEnforceFrom(process.env.EMAIL_VERIFICATION_ENFORCE_FROM),
): boolean {
  if (user.emailVerified || !enforceFrom) return false
  const created = user.createdAt ? new Date(user.createdAt) : null
  // Unknown creation date: treat as existing (never lock out on missing data).
  if (!created || Number.isNaN(created.getTime())) return false
  return created.getTime() >= enforceFrom.getTime()
}

export function lockoutDisabled(): boolean {
  return process.env.AUTH_LOCKOUT_DISABLED === '1'
}

/** IPv6 addresses are bucketed by /48 for the per-IP counter (one customer site). */
export function ipBucket(ip: string): string {
  const m = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/i.exec(ip)
  return m ? `${m[1]}:${m[2]}:${m[3]}::/48` : ip
}

export function lockoutKeys(email: string, ip: string) {
  const e = email.trim().toLowerCase()
  return { emailIp: `login:ei:${e}|${ip}`, ip: `login:ip:${ipBucket(ip)}`, email: `login:e:${e}` }
}

export function isLockedOut(counts: { emailIp: number; ip: number; email?: number }): boolean {
  return counts.emailIp > LOCKOUT.emailIpMax || counts.ip > LOCKOUT.ipMax || (counts.email ?? 0) > LOCKOUT.emailMax
}

/**
 * Counts this attempt up front (atomic INCR) and says whether it is over a limit. Call before
 * bcrypt; on a correct password call releaseLoginAttempt. Unknown emails count the same.
 */
export async function reserveLoginAttempt(email: string, ip: string): Promise<{ locked: boolean }> {
  if (lockoutDisabled()) return { locked: false }
  const k = lockoutKeys(email, ip)
  const [emailIp, ipCount, emailCount] = await Promise.all([
    recordFailure(k.emailIp, WINDOW_MS, LOCKOUT.emailIpMax),
    recordFailure(k.ip, WINDOW_MS, LOCKOUT.ipMax),
    recordFailure(k.email, WINDOW_MS, LOCKOUT.emailMax),
  ])
  return { locked: isLockedOut({ emailIp, ip: ipCount, email: emailCount }) }
}

/** A correct password: the attempt was not a failure. */
export async function releaseLoginAttempt(email: string, ip: string): Promise<void> {
  if (lockoutDisabled()) return
  const k = lockoutKeys(email, ip)
  await Promise.all([clearFailures(k.emailIp), releaseAttempt(k.ip), releaseAttempt(k.email)])
}

/** After a password reset: the owner proved the mailbox, so their account counters start over. */
export async function clearLoginFailures(email: string, ip?: string): Promise<void> {
  const k = lockoutKeys(email, ip || 'none')
  await Promise.all([clearFailures(k.email), ip ? clearFailures(k.emailIp) : Promise.resolve()])
}

/**
 * Client IP from NextAuth's `authorize(credentials, req)`: `req.headers` is a plain object there.
 * Same trust rules as getClientIP (TRUSTED_IP_HEADER only when configured).
 */
export function clientIpFromHeaders(headers: Record<string, unknown> | undefined | null): string {
  const get = (name: string) => {
    if (!headers) return undefined
    const v = headers[name] ?? headers[name.toLowerCase()]
    return Array.isArray(v) ? String(v[0]) : typeof v === 'string' ? v : undefined
  }
  const trusted = (process.env.TRUSTED_IP_HEADER || '').trim().toLowerCase()
  if (trusted) {
    const value = get(trusted)?.split(',')[0]?.trim()
    return value ? normalizeClientIp(value) : 'trusted-header-missing'
  }
  // Right-most X-Forwarded-For hop (appended by our proxy), never the client-chosen first one.
  const xff = get('x-forwarded-for')
  const first = (xff ? rightmostForwarded(xff) : '') || get('x-real-ip')?.trim() || get('cf-connecting-ip')?.trim()
  return first ? normalizeClientIp(first) : 'unknown'
}

let dummyHash: Promise<string> | null = null

/** Spend the same bcrypt time when the email does not exist (no user-enumeration by timing). */
export async function burnPasswordCheck(password: string): Promise<void> {
  if (!dummyHash) dummyHash = hashPassword('betsy-timing-equalizer-Aa1')
  try {
    await verifyPassword(password, await dummyHash)
  } catch {
    // timing only
  }
}
