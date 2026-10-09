/**
 * POST /api/chat/agents/[id]/shortcuts/library — { action: 'seed' } adds the ready-made sales replies;
 * { action: 'import' } copies the team quick replies (text + photos). Both land switched off.
 * update_config + same-origin + heavy rate limit (import reads and re-encodes photos).
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard, studioFail } from '@/lib/agent-studio/route-guard'
import { importTeamQuickReplies, seedSalesReplies } from '@/lib/soft-ai/agent-replies'
import { shortcutErrorStatus } from '@/lib/soft-ai/shortcut-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'heavy')
  if (!g.ok) return g.response
  try {
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null
    const actor = {
      tenantId: g.ctx.tenantId,
      agentId: g.ctx.agent.id,
      actorUserId: g.ctx.userId,
      actorName: g.ctx.actorName,
      actorRole: g.ctx.role,
    }
    if (body?.action === 'seed') return NextResponse.json({ success: true, added: await seedSalesReplies(actor) })
    if (body?.action === 'import') return NextResponse.json({ success: true, ...(await importTeamQuickReplies(actor)) })
    return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
  } catch (error) {
    const mapped = shortcutErrorStatus(error)
    if (mapped) return NextResponse.json({ success: false, error: mapped.code }, { status: mapped.status })
    return studioFail('shortcuts library POST', error)
  }
}
