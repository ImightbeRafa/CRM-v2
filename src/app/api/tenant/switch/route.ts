import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPI } from '@/lib/auth-helpers'
import { getSelectedTenantMembership } from '@/lib/selected-tenant'
import { logAuditEvent } from '@/lib/auditLogger'
import { recordActivity } from '@/lib/activity'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const switchRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 10, identifier: 'tenant-switch' })
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * POST `{ tenantId }` — make another of MY businesses the active one (Phase 2b business switcher).
 *
 * Only with an active membership in an active business (same check every request uses). It only
 * writes User.defaultTenantId; the session picks it up on its next DB sync, which the client forces
 * with next-auth `update()` (the jwt callback ignores any payload). Audited in both businesses.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  const rate = await switchRateLimit(auth.userId)
  if (!rate.allowed) return NextResponse.json({ success: false, error: 'Demasiados cambios seguidos.' }, { status: 429, headers: rate.headers })

  const json = (await request.json().catch(() => null)) as { tenantId?: unknown } | null
  const target = typeof json?.tenantId === 'string' && ID_RE.test(json.tenantId) ? json.tenantId : null
  if (!target) return NextResponse.json({ success: false, error: 'Negocio inválido' }, { status: 400 })
  if (target === auth.tenantId) return NextResponse.json({ success: true, tenantId: target, unchanged: true })

  const membership = await getSelectedTenantMembership(auth.userId, target)
  // Same answer for "not yours" and "does not exist": no probing of other businesses.
  if (!membership) return NextResponse.json({ success: false, error: 'No tenés acceso a ese negocio' }, { status: 403 })

  await prisma.user.updateMany({ where: { id: auth.userId, active: true }, data: { defaultTenantId: target } })

  for (const tenantId of [auth.tenantId, target]) {
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'User',
      entityId: auth.userId,
      description: 'Cambio de negocio activo',
      oldValues: { tenantId: auth.tenantId },
      newValues: { tenantId: target },
      userId: auth.userId,
      userRole: auth.role,
      tenantId,
    }).catch(() => {})
  }
  void recordActivity({ tenantId: target, actorUserId: auth.userId, verb: 'tenant.switch', entityType: 'User', entityId: auth.userId, surface: 'sidebar' })
  return NextResponse.json({ success: true, tenantId: target })
}
