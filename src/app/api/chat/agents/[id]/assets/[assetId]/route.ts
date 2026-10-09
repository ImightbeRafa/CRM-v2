/**
 * GET    /api/chat/agents/[id]/assets/[assetId] — the image bytes (logged in, view_config, tenant + agent scope;
 *        archived images still served so old chat bubbles keep working). Private cache only.
 * DELETE /api/chat/agents/[id]/assets/[assetId] — archive it and unlink it from this agent's replies.
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard, studioFail } from '@/lib/agent-studio/route-guard'
import { archiveAgentAsset, getAgentAsset, readAgentAssetBytes } from '@/lib/soft-ai/agent-assets'
import { safeMediaServeHeaders } from '@/lib/chat-media'
import { logAuditEvent } from '@/lib/auditLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await context.params
  const g = await studioGuard(request, id, 'read')
  if (!g.ok) return g.response
  try {
    const asset = await getAgentAsset(g.ctx.tenantId, g.ctx.agent.id, assetId, { includeArchived: true })
    if (!asset) return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    const bytes = await readAgentAssetBytes(asset)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...safeMediaServeHeaders(asset.mimeType, asset.name),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return studioFail('asset GET', error)
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await context.params
  const g = await studioGuard(request, id, 'write')
  if (!g.ok) return g.response
  try {
    const ok = await archiveAgentAsset(g.ctx.tenantId, g.ctx.agent.id, assetId)
    if (!ok) return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    await logAuditEvent({
      tenantId: g.ctx.tenantId,
      action: 'DELETE',
      entityType: 'ChatAgentAsset',
      entityId: assetId,
      entityName: g.ctx.agent.name,
      description: 'Imagen de respuestas del agente archivada',
      userId: g.ctx.userId,
      userName: g.ctx.actorName,
      userRole: g.ctx.role,
    }).catch(() => undefined)
    return NextResponse.json({ success: true })
  } catch (error) {
    return studioFail('asset DELETE', error)
  }
}
