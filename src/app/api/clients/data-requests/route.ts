import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { dataSubjectRequestsEnabled, erasureTablesReady } from '@/lib/data-subject/availability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Whether customer data export / erasure (Ley 8968) is offered right now (owner view). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'manage_tenant')
  if (!auth.ok) return auth.response
  const enabled = dataSubjectRequestsEnabled()
  return NextResponse.json(
    { export: enabled, erase: enabled && (await erasureTablesReady()) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
