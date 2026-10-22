/**
 * GET /api/estadisticas/anuncios — ad → chat → sale report (Lane E2). Read-only, tenant from the session.
 * ?period=…&from=&to= (CR calendar) &canal=whatsapp|instagram
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { readTenantUiReadiness } from '@/lib/feature-flags'
import { loadAdSalesReport } from '@/lib/insights/insights-server'
import { badPeriod, cached, insightsError, limitInsights, NO_STORE, readPeriod } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_statistics')
    if (!auth.ok) return auth.response
    const limited = await limitInsights(auth.tenantId)
    if (limited) return limited
    const params = request.nextUrl.searchParams
    const period = readPeriod(params)
    if (!period) return badPeriod()
    const canal = params.get('canal')
    const platform = canal === 'whatsapp' || canal === 'instagram' ? canal : null
    const readiness = await readTenantUiReadiness(auth.tenantId)
    const revenueMode = readiness.statistics.enabled && readiness.statistics.mode === 'primary' ? 'collected' : 'booked'
    const report = await cached(auth.tenantId, ['ads', period.range.startDate, period.range.endDate, platform], () =>
      loadAdSalesReport({ tenantId: auth.tenantId, range: period.range, platform }),
    )
    return NextResponse.json({ range: period.range, period: period.spec.period, platform, revenueMode, report }, { headers: NO_STORE })
  } catch (error) {
    return insightsError('anuncios', error)
  }
}
