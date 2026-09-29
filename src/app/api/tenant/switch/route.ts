import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { getSelectedTenantMembership } from '@/lib/selected-tenant'
import { logAuditEvent } from '@/lib/auditLogger'
import { recordActivity } from '@/lib/activity'
import { staffDisplayName } from '@/lib/display-name'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const switchRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 10, identifier: 'tenant-switch' })
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * POST `{ tenantId }` — make another of MY businesses the active one (Phase 2b business switcher).
 *
 * - User-level auth only (it writes the caller's own User row): a billing-restricted current
 *   business must not trap its members (SecureDog L3).
 * - Membership re-checked fresh (active user + membership + business) and AGAIN inside the write
 *   (conditional update, count must be 1 — closes the check/write race, I2).
 * - The session picks the business up through next-auth `update()`, whose payload is ignored.
 * - Audited in both businesses with name / IP / user agent and each business's own role (L5).
 *   Denied attempts go to server logs only (never into a business the caller doesn't belong to).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  const rate = await switchRateLimit(auth.userId)
  if (!rate.allowed) return NextResponse.json({ success: false, error: 'Demasiados cambios seguidos.' }, { status: 429, headers: rate.headers })

  const json = (await request.json().catch(() => null)) as { tenantId?: unknown } | null
  const target = typeof json?.tenantId === 'string' && ID_RE.test(json.tenantId) ? json.tenantId : null
  if (!target) return NextResponse.json({ success: false, error: 'Negocio inválido' }, { status: 400 })
  if (target === auth.unverifiedTenantId) return NextResponse.json({ success: true, tenantId: target, unchanged: true })

  const membership = await getSelectedTenantMembership(auth.userId, target)
  // Same answer for "not yours" and "does not exist": no probing of other businesses.
  if (!membership) {
    console.warn('[tenant-switch] denied', { userId: auth.userId, reason: 'no_active_membership' })
    return NextResponse.json({ success: false, error: 'No tenés acceso a ese negocio' }, { status: 403 })
  }

  const written = await prisma.user.updateMany({
    where: {
      id: auth.userId,
      active: true,
      memberships: { some: { tenantId: target, isActive: true, tenant: { isActive: true } } },
    },
    data: { defaultTenantId: target },
  })
  if (written.count !== 1) {
    console.warn('[tenant-switch] denied', { userId: auth.userId, reason: 'membership_changed' })
    return NextResponse.json({ success: false, error: 'No tenés acceso a ese negocio' }, { status: 403 })
  }

  const actor = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true, username: true } })
  const common = {
    action: 'UPDATE' as const,
    entityType: 'User',
    entityId: auth.userId,
    description: 'Cambio de negocio activo',
    userId: auth.userId,
    userName: staffDisplayName(actor?.name ?? null, actor?.username ?? null) || 'Usuario',
    ipAddress: getClientIP(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
  }
  // Each business only sees that the user left / joined it, with its own role (no other ids).
  // The "left" row only if the user is STILL an active member there (a removed member never
  // writes into that business's log).
  const previous = auth.unverifiedTenantId ? await getSelectedTenantMembership(auth.userId, auth.unverifiedTenantId) : null
  if (previous) {
    await logAuditEvent({ ...common, userRole: previous.role, tenantId: previous.tenantId, oldValues: { active: true }, newValues: { active: false } }).catch(() => {})
  }
  await logAuditEvent({ ...common, userRole: membership.role, tenantId: target, oldValues: { active: false }, newValues: { active: true } }).catch(() => {})
  void recordActivity({ tenantId: target, actorUserId: auth.userId, verb: 'tenant.switch', entityType: 'User', entityId: auth.userId, surface: 'sidebar' })
  return NextResponse.json({ success: true, tenantId: target })
}
