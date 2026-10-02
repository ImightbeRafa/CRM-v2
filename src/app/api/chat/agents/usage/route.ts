/**
 * GET /api/chat/agents/usage — this business's own agent usage (volume and outcomes, never dollars).
 * tenantId always comes from the session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  clampUsageDays,
  parseUsageMode,
  stripSummaryCost,
  summarizeAgentUsage,
} from '@/lib/soft-ai/agent-usage'
import {
  loadAgentNames,
  loadAgentP95Latency,
  loadAgentUsageRows,
} from '@/lib/soft-ai/agent-usage-server'
import { memoTtl } from '@/lib/soft-ai/safe-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response

    const params = request.nextUrl.searchParams
    const days = Math.min(30, clampUsageDays(params.get('days')))
    const mode = parseUsageMode(params.get('mode'))
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)

    const payload = await memoTtl(`usage:${auth.tenantId}:${days}:${mode}`, 60_000, async () => {
      const [rows, p95] = await Promise.all([
        loadAgentUsageRows({ from, to, tenantId: auth.tenantId }),
        loadAgentP95Latency({ from, to, tenantId: auth.tenantId, mode }),
      ])
      const summary = stripSummaryCost(summarizeAgentUsage(rows, mode, p95))
      const agentNames = await loadAgentNames(
        summary.byAgent.map((row) => row.agentId),
        auth.tenantId,
      )
      return { summary, agentNames }
    })
    return NextResponse.json(
      { success: true, days, mode, ...payload },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat/agents/usage GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar el uso' }, { status: 500 })
  }
}
