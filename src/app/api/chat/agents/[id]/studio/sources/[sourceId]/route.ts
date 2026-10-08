/**
 * DELETE /api/chat/agents/[id]/studio/sources/[sourceId] — remove a source (its text is wiped; tenant + agent scoped).
 */
import { NextRequest, NextResponse } from 'next/server'
import { removeSource } from '@/lib/agent-studio/source-store'
import { studioFail, studioGuard } from '@/lib/agent-studio/route-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await context.params
  const g = await studioGuard(request, id, 'write')
  if (!g.ok) return g.response
  try {
    const removed = await removeSource(g.ctx.tenantId, g.ctx.agent.id, sourceId)
    if (!removed) return NextResponse.json({ success: false, error: 'Fuente no encontrada' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return studioFail('source DELETE', error)
  }
}
