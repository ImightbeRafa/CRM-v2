/**
 * GET /api/estadisticas/clientes/recurrentes — customers with 2+ orders (Lane E2).
 * Lists names and phones: needs view_statistics AND view_sales. Tenant from the session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/rbac'
import { loadRepeatBuyers, REPEAT_SORTS, type RepeatSort } from '@/lib/insights/customers-server'
import { cached, insightsError, NO_STORE } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_statistics')
    if (!auth.ok) return auth.response
    if (!hasPermission(auth.role, 'view_sales')) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403, headers: NO_STORE })
    }
    const params = request.nextUrl.searchParams
    const rawSort = params.get('orden')
    const sort: RepeatSort = (REPEAT_SORTS as readonly string[]).includes(rawSort ?? '') ? (rawSort as RepeatSort) : 'recientes'
    const page = Math.min(200, Math.max(0, Math.floor(Number(params.get('pagina')) || 0)))
    const data = await cached(auth.tenantId, ['repeat', sort, page], () =>
      loadRepeatBuyers({ tenantId: auth.tenantId, sort, page, pageSize: PAGE_SIZE }),
    )
    return NextResponse.json({ sort, page, pageSize: PAGE_SIZE, ...data }, { headers: NO_STORE })
  } catch (error) {
    return insightsError('recurrentes', error)
  }
}
