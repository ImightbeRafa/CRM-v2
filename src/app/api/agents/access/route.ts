import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/auth-helpers'
import { getCustomAgentAccess } from '@/lib/support/agent-access'
import { supportPipelineEnabled } from '@/lib/support/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Drives the Agents tab: `{enabled}` → the tenant's agent editor, otherwise the sales page.
 * Tenant from the session only. `sales` tells the page whether the "Quiero mi agente" form works.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request, { skipBillingGuard: true })
  if (!auth.ok) return auth.response
  try {
    const access = await getCustomAgentAccess(auth.tenantId, auth.userId)
    return NextResponse.json(
      { enabled: access.enabled, sales: supportPipelineEnabled() },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    // Fail closed for the editor; the sales page still renders.
    return NextResponse.json({ enabled: false, sales: supportPipelineEnabled() }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
