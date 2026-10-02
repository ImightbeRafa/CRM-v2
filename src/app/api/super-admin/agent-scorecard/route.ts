/**
 * GET /api/super-admin/agent-scorecard — agent quality by version across all businesses.
 * Betsy platform admins only (404 to others). Aggregates only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { clampUsageDays } from '@/lib/soft-ai/agent-usage'
import { loadAgentScorecard } from '@/lib/soft-ai/agent-improvement'
import { loadAgentNames } from '@/lib/soft-ai/agent-usage-server'

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
    const days = clampUsageDays(request.nextUrl.searchParams.get('days'))
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)
    const { rows, feedbackReady } = await loadAgentScorecard({ from, to, tenantId: null })
    const agentNames = await loadAgentNames([...new Set(rows.map((r) => r.agentId))], null)
    await logAuditEvent({
      action: 'EXPORT',
      entityType: 'agent_scorecard',
      entityId: 'platform',
      description: `Abrió la calidad de agentes (${days} días)`,
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auth.tenantId,
    })
    return NextResponse.json(
      { success: true, days, feedbackReady, rows, agentNames },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('[super-admin/agent-scorecard] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Failed' }, { status: 500, headers: NO_STORE })
  }
}
