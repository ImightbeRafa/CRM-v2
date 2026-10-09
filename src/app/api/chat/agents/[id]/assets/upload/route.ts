/**
 * POST /api/chat/agents/[id]/assets/upload — one image (multipart "file", ≤8 MB in) for the agent's replies.
 * Re-encoded to jpeg/png ≤1600 px without metadata (agent-assets.ts). update_config + same-origin + limits.
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard } from '@/lib/agent-studio/route-guard'
import { AgentAssetError, MAX_ASSET_INPUT_BYTES, publicAgentAsset, storeAgentAsset } from '@/lib/soft-ai/agent-assets'
import { logAuditEvent } from '@/lib/auditLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MESSAGES: Record<AgentAssetError['code'], [number, string]> = {
  not_ready: [409, 'Las imágenes del agente todavía no están disponibles.'],
  not_image: [400, 'Subí una foto JPG, PNG o WebP.'],
  too_large: [413, 'La imagen es demasiado grande.'],
  quota: [429, 'Se llenó el espacio para imágenes del negocio (200 MB).'],
  not_found: [404, 'No encontrado'],
  storage: [503, 'No se pudo guardar la imagen. Probá de nuevo.'],
  busy: [409, 'Estamos procesando otras imágenes. Probá en unos segundos.'],
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const g = await studioGuard(request, id, 'heavy')
  if (!g.ok) return g.response
  try {
    const declared = Number(request.headers.get('content-length') || 0)
    if (!declared) return NextResponse.json({ success: false, error: 'Falta el tamaño del archivo.' }, { status: 411 })
    if (declared > MAX_ASSET_INPUT_BYTES + 64_000) return NextResponse.json({ success: false, error: MESSAGES.too_large[1] }, { status: 413 })
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return NextResponse.json({ success: false, error: 'Falta la imagen.' }, { status: 400 })
    if (file.size > MAX_ASSET_INPUT_BYTES) return NextResponse.json({ success: false, error: MESSAGES.too_large[1] }, { status: 413 })
    const caption = form?.get('caption')
    const asset = await storeAgentAsset({
      tenantId: g.ctx.tenantId,
      agentId: g.ctx.agent.id,
      bytes: Buffer.from(await file.arrayBuffer()),
      name: file.name || 'imagen',
      caption: typeof caption === 'string' ? caption : null,
      userId: g.ctx.userId,
    })
    // MEDIA-12: who added which image (an image can carry a price or an account number the text checks never see).
    await logAuditEvent({
      tenantId: g.ctx.tenantId,
      action: 'CREATE',
      entityType: 'ChatAgentAsset',
      entityId: asset.id,
      entityName: g.ctx.agent.name,
      description: 'Imagen para respuestas del agente',
      newValues: { name: asset.name, sha256: asset.sha256, sizeBytes: asset.sizeBytes, agentId: g.ctx.agent.id },
      userId: g.ctx.userId,
      userName: g.ctx.actorName,
      userRole: g.ctx.role,
    }).catch(() => undefined)
    return NextResponse.json({ success: true, asset: publicAgentAsset(asset) })
  } catch (error) {
    if (error instanceof AgentAssetError) {
      const [status, message] = MESSAGES[error.code]
      return NextResponse.json({ success: false, error: message }, { status })
    }
    console.error('[agent assets upload]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error inesperado' }, { status: 500 })
  }
}
