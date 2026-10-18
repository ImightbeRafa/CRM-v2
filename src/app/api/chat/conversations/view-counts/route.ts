import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { loadStages } from '@/lib/crm-stages-server'
import { loadInboxViewCounts } from '@/lib/chat-inbox-views-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** /chats quick-view counts per line for the session's business (one grouped query). */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { stages } = await loadStages(auth.tenantId, 'chat')
    const byAccount = await loadInboxViewCounts(auth.tenantId, stages)
    return NextResponse.json({ success: true, byAccount }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[chat/conversations/view-counts GET]', { code: error instanceof Error ? error.name : 'error' })
    return NextResponse.json({ success: false, error: 'counts_failed' }, { status: 500 })
  }
}
