import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { getClientIP } from '@/lib/rate-limit'
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
