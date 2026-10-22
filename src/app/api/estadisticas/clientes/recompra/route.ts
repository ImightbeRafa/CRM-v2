/**
 * GET /api/estadisticas/clientes/recompra — customers due to reorder in the next N days (Lane E2).
 * Nothing is sent: the list only offers "abrir chat" + a suggested message.
 * Lists names and phones: needs view_statistics AND view_sales. Tenant from the session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/rbac'
import { loadReorderDue } from '@/lib/insights/customers-server'
import { clampWindowDays, REORDER_LIMITS } from '@/lib/insights/reorder'
import { cached, insightsError, NO_STORE } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_statistics')
    if (!auth.ok) return auth.response
    if (!hasPermission(auth.role, 'view_sales')) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403, headers: NO_STORE })
    }
    const params = request.nextUrl.searchParams
    const windowDays = clampWindowDays(params.get('dias'), 7)
    const overdueDays = Math.min(REORDER_LIMITS.maxOverdue, clampWindowDays(params.get('vencidos'), 14))
    // Short cache: a rule change must show up quickly.
    const data = await cached(
      auth.tenantId,
      ['reorder', windowDays, overdueDays],
      () => loadReorderDue({ tenantId: auth.tenantId, windowDays, overdueDays }),
      10_000,
    )
    return NextResponse.json({ windowDays, overdueDays, ...data }, { headers: NO_STORE })
  } catch (error) {
    return insightsError('recompra', error)
  }
}
