/**
 * POST /api/chat/agents/[id]/studio/draft/apply — { draftId, selection } writes what the owner kept/edited into
 * the agent (brand facts, knowledge, shortcuts, products, selling script). Audited by each store; the agent version
 * bumps, so it must pass its tests again before Activar. update_config + same-origin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/lib/auditLogger'
import { applyProfileDraft, type ApplySelection } from '@/lib/agent-studio/apply'
import { studioFail, studioGuard } from '@/lib/agent-studio/route-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'write')
  if (!g.ok) return g.response
  try {
    const body = (await request.json().catch(() => null)) as { draftId?: unknown; selection?: unknown } | null
    const draftId = typeof body?.draftId === 'string' ? body.draftId : ''
    const selection = body?.selection && typeof body.selection === 'object' && !Array.isArray(body.selection) ? (body.selection as ApplySelection) : null
    if (!draftId || !selection) return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    if (JSON.stringify(selection).length > 200_000) return NextResponse.json({ success: false, error: 'Demasiados datos' }, { status: 413 })
    const result = await applyProfileDraft({
      tenantId: g.ctx.tenantId,
      agentId: g.ctx.agent.id,
      draftId,
      actor: { userId: g.ctx.userId, name: g.ctx.actorName, role: g.ctx.role },
      selection,
    })
    await logAuditEvent({
      tenantId: g.ctx.tenantId,
      action: 'UPDATE',
      entityType: 'ChatAgent',
      entityId: g.ctx.agent.id,
      entityName: g.ctx.agent.name,
      oldValues: null,
      newValues: { studioDraftId: draftId, ...result },
      userId: g.ctx.userId,
      userName: g.ctx.actorName,
      userRole: g.ctx.role,
      reason: 'agent_studio_apply',
    }).catch(() => undefined)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return studioFail('apply POST', error)
  }
}
