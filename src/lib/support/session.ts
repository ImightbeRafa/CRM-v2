/**
 * Session → support viewer. Tenant and role come from the verified session only
 * (never the body). Billing-restricted businesses still reach support.
 */
import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { supportPipelineEnabled } from './config'
import type { SupportViewer } from './access'

export async function supportViewer(
  request: NextRequest,
): Promise<{ ok: true; viewer: SupportViewer } | { ok: false; response: NextResponse }> {
  if (!supportPipelineEnabled()) {
    return { ok: false, response: NextResponse.json({ error: 'support_disabled' }, { status: 404 }) }
  }
  const auth = await authenticateAPI(request, { skipBillingGuard: true })
  if (!auth.ok) return { ok: false, response: auth.response }
  return { ok: true, viewer: { userId: auth.userId, tenantId: auth.tenantId, role: auth.role } }
}

export async function viewerContact(userId: string): Promise<{ name: string | null; email: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  return user?.email ? { name: user.name, email: user.email } : null
}
