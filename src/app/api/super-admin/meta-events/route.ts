/**
 * GET /api/super-admin/meta-events — ad sales events sent to Meta (Conversions API for Business Messaging), all
 * businesses (Betsy platform admins only). Ids, amounts, statuses and Meta trace ids only. Non-admins get 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { loadMetaEventLog, parseEventLogFilters } from '@/lib/meta-attribution/event-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  if (!(await isSuperAdmin(auth.userId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }
  try {
    const filters = parseEventLogFilters(request.nextUrl.searchParams)
    const data = await loadMetaEventLog(filters)
    await logAuditEvent({
      action: 'EXPORT',
      entityType: 'meta_event_log',
      entityId: filters.tenantId || 'platform',
      description: 'Abrió el registro de eventos de Meta',
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auth.tenantId,
    })
    return NextResponse.json({ success: true, data: { ...data, filters } }, { headers: NO_STORE })
  } catch (error) {
    console.error('[super-admin/meta-events] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500, headers: NO_STORE })
  }
}
