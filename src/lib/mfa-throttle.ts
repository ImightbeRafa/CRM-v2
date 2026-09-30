import 'server-only'
import { createHash } from 'crypto'
import { clearFailures, failureCount, getClientIP, recordFailure } from '@/lib/rate-limit'

/**
 * Wrong-code throttle for two-step login, on top of the hard per-challenge limit in the DB (5).
 * Per user (hashed id) and per IP, 15 min window. Upstash when configured, memory otherwise.
 */
const WINDOW_MS = 15 * 60_000
export const MFA_USER_FAILURE_LIMIT = 10
export const MFA_IP_FAILURE_LIMIT = 30

function userKey(userId: string): string {
  return `mfa:u:${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`
}
function ipKey(request: Request): string {
  return `mfa:ip:${createHash('sha256').update(getClientIP(request)).digest('hex').slice(0, 32)}`
}

export async function mfaThrottled(userId: string, request: Request): Promise<boolean> {
  const [u, ip] = await Promise.all([failureCount(userKey(userId)), failureCount(ipKey(request))])
  return u >= MFA_USER_FAILURE_LIMIT || ip >= MFA_IP_FAILURE_LIMIT
}

export async function recordMfaFailure(userId: string, request: Request): Promise<void> {
  await Promise.all([
    recordFailure(userKey(userId), WINDOW_MS, MFA_USER_FAILURE_LIMIT),
    recordFailure(ipKey(request), WINDOW_MS, MFA_IP_FAILURE_LIMIT),
  ])
}

export async function clearMfaFailures(userId: string): Promise<void> {
  await clearFailures(userKey(userId))
}
