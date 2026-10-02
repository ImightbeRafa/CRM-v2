/**
 * GET /api/super-admin/agent-usage — platform-wide INBOX agent usage (Betsy platform admins only).
 * Aggregates only: no customer or output text. Non-admins get 404 (same posture as /health).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { isSuperAdmin } from '@/lib/super-admin-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import {
  clampUsageDays,
  parseUsageMode,
  summarizeAgentUsage,
} from '@/lib/soft-ai/agent-usage'
import {
  loadAgentNames,
  loadAgentP95Latency,
  loadAgentUsageRows,
  loadTenantNames,
} from '@/lib/soft-ai/agent-usage-server'
import { OPENAI_PRICING_VERSION, XAI_PRICING_VERSION } from '@/lib/soft-ai/agent-types'

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
    const params = request.nextUrl.searchParams
    const days = clampUsageDays(params.get('days'))
    const mode = parseUsageMode(params.get('mode'))
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)

    const [rows, p95] = await Promise.all([
      loadAgentUsageRows({ from, to, tenantId: null }),
      loadAgentP95Latency({ from, to, tenantId: null, mode }),
    ])
    const summary = summarizeAgentUsage(rows, mode, p95)
    const [tenantNames, agentNames] = await Promise.all([
      loadTenantNames(summary.byTenant.map((row) => row.tenantId)),
      loadAgentNames(summary.byAgent.map((row) => row.agentId), null),
    ])

    await logAuditEvent({
      action: 'EXPORT',
      entityType: 'agent_usage_dashboard',
      entityId: 'platform',
      description: `Abrió Agent Ops (${days} días, ${mode})`,
      userId: auth.userId,
      userRole: 'SUPER_ADMIN',
      tenantId: auth.tenantId,
    })

    return NextResponse.json(
      {
        success: true,
        days,
        mode,
        estimated: true,
        pricingVersions: [XAI_PRICING_VERSION, OPENAI_PRICING_VERSION],
        disclaimer:
          'Costos estimados a precio de lista; no son la factura del proveedor.',
        summary,
        tenantNames,
        agentNames,
        truncated: rows.length >= 5_000,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('[super-admin/agent-usage] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Failed' }, { status: 500, headers: NO_STORE })
  }
}
