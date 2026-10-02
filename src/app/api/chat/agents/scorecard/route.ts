/**
 * GET /api/chat/agents/scorecard — this business's agent quality by version (rates, never dollars).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { clampUsageDays } from '@/lib/soft-ai/agent-usage'
import { loadAgentScorecard } from '@/lib/soft-ai/agent-improvement'
import { loadAgentNames } from '@/lib/soft-ai/agent-usage-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const days = clampUsageDays(request.nextUrl.searchParams.get('days'))
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)
    const { rows, feedbackReady } = await loadAgentScorecard({ from, to, tenantId: auth.tenantId })
    const agentNames = await loadAgentNames(
      [...new Set(rows.map((r) => r.agentId))],
      auth.tenantId,
    )
    return NextResponse.json(
      { success: true, days, feedbackReady, rows, agentNames },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat/agents/scorecard GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}
