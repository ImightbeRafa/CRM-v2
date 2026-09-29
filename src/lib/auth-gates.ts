/**
 * Credentials login gates (security, 2026-09-28): email verification for new accounts, failed-login
 * lockout, and constant-ish timing for unknown emails. Every gate is designed so that no existing
 * user can be locked out by the deploy itself:
 *
 * - Email verification is OFF until `EMAIL_VERIFICATION_ENFORCE_FROM` (ISO date) is set, and then
 *   only applies to accounts created at/after that instant. Existing unverified users are exempt by
 *   construction. Recovery: resend the verification email, or reset the password (verifies).
 * - Lockout is time-based only (no DB state), keyed on email+IP (5 failures / 15 min) and on IP
 *   (30 / 15 min). There is deliberately no hard per-email lock across all IPs: that would let
 *   anyone lock an owner out by typing wrong passwords for them. A successful login or password
 *   reset clears the email+IP counter. Kill switch: `AUTH_LOCKOUT_DISABLED=1`.
 * - Failures for emails that do not exist are counted too, so a lock reveals nothing.
 */
import { normalizeClientIp, clearFailures, failureCount, recordFailure } from '@/lib/rate-limit'
import { hashPassword, verifyPassword } from '@/lib/password'

export const LOGIN_ERRORS = {
  emailNotVerified: 'EMAIL_NOT_VERIFIED',
  locked: 'LOCKED',
} as const

const WINDOW_MS = 15 * 60 * 1000
export const LOCKOUT = {
  emailIpMax: 5,
  ipMax: 30,
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

export function lockoutKeys(email: string, ip: string) {
  const e = email.trim().toLowerCase()
  return { emailIp: `login:ei:${e}|${ip}`, ip: `login:ip:${ip}` }
}

export function isLockedOut(counts: { emailIp: number; ip: number }): boolean {
  return counts.emailIp >= LOCKOUT.emailIpMax || counts.ip >= LOCKOUT.ipMax
}

export async function loginLocked(email: string, ip: string): Promise<boolean> {
  if (lockoutDisabled()) return false
  const k = lockoutKeys(email, ip)
  const [emailIp, ipCount] = await Promise.all([failureCount(k.emailIp), failureCount(k.ip)])
  return isLockedOut({ emailIp, ip: ipCount })
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  if (lockoutDisabled()) return
  const k = lockoutKeys(email, ip)
  await Promise.all([
    recordFailure(k.emailIp, WINDOW_MS, LOCKOUT.emailIpMax),
    recordFailure(k.ip, WINDOW_MS, LOCKOUT.ipMax),
  ])
}

export async function clearLoginFailures(email: string, ip?: string): Promise<void> {
  if (ip) await clearFailures(lockoutKeys(email, ip).emailIp)
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
  const first = get('x-forwarded-for')?.split(',')[0]?.trim() || get('x-real-ip')?.trim() || get('cf-connecting-ip')?.trim()
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
