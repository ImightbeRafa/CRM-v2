import 'server-only'
import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { verifyPassword } from '@/lib/password'
import { createHash } from 'crypto'
import { getClientIP, recordFailure, releaseAttempt } from '@/lib/rate-limit'
import { PII_NO_STORE_HEADERS } from '@/lib/security'

/** Shared bits of the /api/account/2fa/* routes (the signed-in user managing their own 2FA). */
export function mfaReply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: PII_NO_STORE_HEADERS })
}

export type MfaAuditEvent = 'enabled' | 'disabled' | 'recovery_codes_regenerated'

/**
 * One audit row per business the user belongs to (AuditLog.tenantId is required): owners see
 * when a teammate's 2FA changes. Ids and the event only; never codes or secrets.
 */
export async function auditMfaChange(userId: string, event: MfaAuditEvent, request: Request): Promise<void> {
  try {
    const memberships = await prisma.membership.findMany({
      where: { userId, isActive: true },
      select: { tenantId: true, role: true },
    })
    await Promise.all(
      memberships.map((m) =>
        logAuditEvent({
          action: 'UPDATE',
          entityType: 'UserTwoFactor',
          entityId: userId,
          description: `2FA ${event}`,
          newValues: { event },
          userId,
          userRole: m.role,
          tenantId: m.tenantId,
          ipAddress: getClientIP(request),
          userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
        }),
      ),
    )
  } catch {
    // Audit is best effort; the change itself already happened.
  }
}

export function readFactorInput(body: unknown): { code: string | null; recoveryCode: string | null } {
  const b = (body && typeof body === 'object' ? body : {}) as { code?: unknown; recoveryCode?: unknown }
  const code = typeof b.code === 'string' && b.code.trim() ? b.code.trim().slice(0, 12) : null
  const recoveryCode = typeof b.recoveryCode === 'string' && b.recoveryCode.trim() ? b.recoveryCode.trim().slice(0, 24) : null
  return { code, recoveryCode }
}

/** How recently this session signed in (set by the jwt callback at sign-in). */
export const FRESH_SIGN_IN_MS = 15 * 60_000

/** Wrong passwords on 2FA account changes: 5 per 15 min per user, reserved first (AUTH-52). */
const PASSWORD_WINDOW_MS = 15 * 60_000
export const PASSWORD_PROOF_LIMIT = 5
export const OWNER_PROOF_FAILED = 'Contraseña o código incorrecto.'

function passwordKey(userId: string): string {
  return `mfa-pw:${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`
}

/**
 * Proof that the person at the keyboard is the account owner, not just someone holding an open
 * session (SecureDog AUTH-44): the password for password accounts; a sign-in in the last 15 minutes
 * for Google-only accounts.
 */
export async function proveAccountOwner(
  request: Request,
  userId: string,
  password: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } })
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  if (user.password) {
    if (typeof password !== 'string' || !password) return { ok: false, status: 400, error: OWNER_PROOF_FAILED }
    // Reserve BEFORE the (costly) bcrypt compare; give the slot back when it was right.
    const used = await recordFailure(passwordKey(userId), PASSWORD_WINDOW_MS, PASSWORD_PROOF_LIMIT)
    if (used > PASSWORD_PROOF_LIMIT) {
      return { ok: false, status: 429, error: 'Demasiados intentos. Esperá unos minutos.' }
    }
    if (!(await verifyPassword(password, user.password))) return { ok: false, status: 400, error: OWNER_PROOF_FAILED }
    await releaseAttempt(passwordKey(userId))
    return { ok: true }
  }
  const secret = process.env.NEXTAUTH_SECRET
  const token = secret ? await getToken({ req: request as never, secret }).catch(() => null) : null
  const authAt = Number((token as { authAt?: unknown } | null)?.authAt)
  if (!Number.isFinite(authAt) || Date.now() - authAt > FRESH_SIGN_IN_MS) {
    return { ok: false, status: 403, error: 'Por seguridad, cerrá sesión y volvé a entrar con Google antes de continuar.' }
  }
  return { ok: true }
}
