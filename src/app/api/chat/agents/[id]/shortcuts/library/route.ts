/**
 * POST /api/chat/agents/[id]/shortcuts/library — { action: 'seed' } adds the ready-made sales replies;
 * { action: 'import' } copies the team quick replies (text + photos). Both land switched off.
 * update_config + same-origin + heavy rate limit (import reads and re-encodes photos).
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard, studioFail } from '@/lib/agent-studio/route-guard'
import { importTeamQuickReplies, seedSalesReplies } from '@/lib/soft-ai/agent-replies'
import { shortcutErrorStatus } from '@/lib/soft-ai/shortcut-admin'
import { logAuditEvent } from '@/lib/auditLogger'

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
    if (body?.action === 'import') {
      const result = await importTeamQuickReplies(actor)
      await logAuditEvent({
        tenantId: g.ctx.tenantId,
        action: 'CREATE',
        entityType: 'ChatAgentShortcut',
        entityId: g.ctx.agent.id,
        entityName: g.ctx.agent.name,
        description: 'Respuestas rápidas del equipo copiadas al agente',
        newValues: result,
        userId: g.ctx.userId,
        userName: g.ctx.actorName,
        userRole: g.ctx.role,
      }).catch(() => undefined)
      return NextResponse.json({ success: true, ...result })
    }
    return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
  } catch (error) {
    const mapped = shortcutErrorStatus(error)
    if (mapped) return NextResponse.json({ success: false, error: mapped.code }, { status: mapped.status })
    return studioFail('shortcuts library POST', error)
  }
}
