/**
 * GET /api/estadisticas/equipo — chat metrics for the team (Lane E2). Read-only, tenant from the session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { loadTeamChatReport } from '@/lib/insights/insights-server'
import { badPeriod, cached, insightsError, limitInsights, NO_STORE, readPeriod } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_statistics')
    if (!auth.ok) return auth.response
    const limited = await limitInsights(auth.tenantId)
    if (limited) return limited
    const period = readPeriod(request.nextUrl.searchParams)
    if (!period) return badPeriod()
    const data = await cached(auth.tenantId, ['team', period.range.startDate, period.range.endDate], () =>
      loadTeamChatReport({ tenantId: auth.tenantId, range: period.range }),
    )
    return NextResponse.json({ range: period.range, period: period.spec.period, ...data }, { headers: NO_STORE })
  } catch (error) {
    return insightsError('equipo', error)
  }
}
