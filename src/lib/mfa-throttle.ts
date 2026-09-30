import 'server-only'
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientIP, recordFailure, releaseAttempt } from '@/lib/rate-limit'
import { ipBucket } from '@/lib/auth-gates'
import { sendSecurityNoticeEmail, type SecurityNoticeKind } from '@/lib/email'

/**
 * Per-network cap on 2FA code checks, on top of the atomic per-user budget in the DB
 * (mfa-state.reserveMfaAttempt, the hard limit). Reserve FIRST (counter +1, refuse when over), give
 * the slot back on success — never check-then-act (SecureDog AUTH-43).
 */
const WINDOW_MS = 15 * 60_000
export const MFA_IP_LIMIT = 30

function ipKey(request: Request): string {
  // IPv6 /64s bucketed to /48 (rotating addresses inside one network share the slot).
  return `mfa:ip:${createHash('sha256').update(ipBucket(getClientIP(request))).digest('hex').slice(0, 32)}`
}

export async function reserveMfaIpSlot(request: Request): Promise<boolean> {
  const count = await recordFailure(ipKey(request), WINDOW_MS, MFA_IP_LIMIT)
  return count <= MFA_IP_LIMIT
}

export async function releaseMfaIpSlot(request: Request): Promise<void> {
  await releaseAttempt(ipKey(request))
}

/** Best-effort security email to the account owner (never blocks the request's outcome). */
export async function notifyMfaEvent(userId: string, kind: SecurityNoticeKind): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (user?.email) await sendSecurityNoticeEmail({ email: user.email, kind })
  } catch {
    // mail is best effort
  }
}
