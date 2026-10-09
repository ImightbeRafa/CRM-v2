/**
 * POST /api/chat/agents/[id]/assets/upload — one image (multipart "file", ≤8 MB in) for the agent's replies.
 * Re-encoded to jpeg/png ≤1600 px without metadata (agent-assets.ts). update_config + same-origin + limits.
 */
import { NextRequest, NextResponse } from 'next/server'
import { studioGuard } from '@/lib/agent-studio/route-guard'
import { AgentAssetError, MAX_ASSET_INPUT_BYTES, storeAgentAsset } from '@/lib/soft-ai/agent-assets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MESSAGES: Record<AgentAssetError['code'], [number, string]> = {
  not_ready: [409, 'Las imágenes del agente todavía no están disponibles.'],
  not_image: [400, 'Ese archivo no es una imagen.'],
  too_large: [413, 'La imagen es demasiado grande.'],
  quota: [429, 'Se llenó el espacio para imágenes del negocio. Quitá alguna primero.'],
  not_found: [404, 'No encontrado'],
  storage: [503, 'No se pudo guardar la imagen. Probá de nuevo.'],
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
    return NextResponse.json({ success: true, asset })
  } catch (error) {
    if (error instanceof AgentAssetError) {
      const [status, message] = MESSAGES[error.code]
      return NextResponse.json({ success: false, error: message }, { status })
    }
    console.error('[agent assets upload]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error inesperado' }, { status: 500 })
  }
}
