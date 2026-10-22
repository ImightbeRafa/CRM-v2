/**
 * GET /api/chat/agents/performance — per-agent results for this business (Lane E2).
 * Same gate as the rest of the agent editor (custom_agents while the support pipeline is on).
 * Tenant from the session; only this business's agents are returned. Cost in USD (estimate).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgentAPI } from '@/lib/support/agent-access'
import { hasPermission } from '@/lib/rbac'
import { loadAgentPerformance } from '@/lib/insights/insights-server'
import { badPeriod, cached, insightsError, limitInsights, NO_STORE, readPeriod } from '@/lib/insights/route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AGENT_PERIODS: readonly string[] = ['7d', '30d', 'mes', 'mes-pasado']

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAgentAPI(request, 'view_config')
    if (!auth.ok) return auth.response
    // Money per agent: only roles that may see statistics (SALES has view_config but not view_statistics).
    if (!hasPermission(auth.role, 'view_statistics')) {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403, headers: NO_STORE })
    }
    const limited = await limitInsights(auth.tenantId)
    if (limited) return limited
    // Only the card's fixed periods (no free ranges: every new range would be an uncached load).
    const period = readPeriod(request.nextUrl.searchParams)
    if (!period || !AGENT_PERIODS.includes(period.spec.period)) return badPeriod()
    const agents = await cached(auth.tenantId, ['agents', period.range.startDate, period.range.endDate], () =>
      loadAgentPerformance({ tenantId: auth.tenantId, range: period.range }),
    )
    return NextResponse.json({ range: period.range, period: period.spec.period, agents }, { headers: NO_STORE })
  } catch (error) {
    return insightsError('agents/performance', error)
  }
}
