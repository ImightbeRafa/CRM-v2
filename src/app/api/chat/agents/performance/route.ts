/**
 * GET /api/chat/agents/performance — per-agent results for this business (Lane E2).
 * Same gate as the rest of the agent editor (custom_agents while the support pipeline is on).
 * Tenant from the session; only this business's agents are returned. Cost in USD (estimate).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgentAPI } from '@/lib/support/agent-access'
import { loadAgentPerformance } from '@/lib/insights/insights-server'
import { badPeriod, cached, insightsError, NO_STORE, readPeriod } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAgentAPI(request, 'view_config')
    if (!auth.ok) return auth.response
    const period = readPeriod(request.nextUrl.searchParams)
    if (!period) return badPeriod()
    const agents = await cached(auth.tenantId, ['agents', period.range.startDate, period.range.endDate], () =>
      loadAgentPerformance({ tenantId: auth.tenantId, range: period.range }),
    )
    return NextResponse.json({ range: period.range, period: period.spec.period, agents }, { headers: NO_STORE })
  } catch (error) {
    return insightsError('agents/performance', error)
  }
}
