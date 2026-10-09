/**
 * PUT /api/chat/agents/[id]/shortcuts/[shortcutId]/assets — { assetIds: string[] } (≤3, in order): the images this
 * reply sends. Reply and every image re-checked against tenant + agent. update_config + same-origin + rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard, studioFail } from '@/lib/agent-studio/route-guard'
import { AgentAssetError, setReplyAssets } from '@/lib/soft-ai/agent-assets'
import { logAuditEvent } from '@/lib/auditLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string; shortcutId: string }> }) {
  const { id, shortcutId } = await context.params
  const g = await studioGuard(request, id, 'write')
  if (!g.ok) return g.response
  try {
    const body = (await request.json().catch(() => null)) as { assetIds?: unknown } | null
    const assetIds = Array.isArray(body?.assetIds) ? body.assetIds.filter((x): x is string => typeof x === 'string').slice(0, 3) : null
    if (!assetIds) return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    const stored = await setReplyAssets({ tenantId: g.ctx.tenantId, agentId: g.ctx.agent.id, shortcutId, assetIds })
    await logAuditEvent({
      tenantId: g.ctx.tenantId,
      action: 'UPDATE',
      entityType: 'ChatAgentShortcut',
      entityId: shortcutId,
      entityName: g.ctx.agent.name,
      description: 'Imágenes de una respuesta del agente',
      newValues: { assetIds: assetIds.slice(0, stored) },
      userId: g.ctx.userId,
      userName: g.ctx.actorName,
      userRole: g.ctx.role,
    }).catch(() => undefined)
    return NextResponse.json({ success: true, stored })
  } catch (error) {
    if (error instanceof AgentAssetError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'not_ready' ? 409 : 400
      return NextResponse.json({ success: false, error: status === 404 ? 'Respuesta no encontrada' : 'No se pudo guardar' }, { status })
    }
    return studioFail('shortcut assets PUT', error)
  }
}
