/**
 * GET /api/chat/agents/[id]/knowledge-map — the agent's Mapa de conocimiento: standard template per product and
 * store, measured against what fits the prompt, conflicts with the structured facts, and the live gaps (questions
 * the agent could not answer in the last 90 days). Read-only. tenantId from the session; view_config; customer
 * questions only for roles that can already read the inbox (update_sales).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/rbac'
import { loadKnowledgeMap } from '@/lib/soft-ai/knowledge-map-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const map = await loadKnowledgeMap({
      tenantId: auth.tenantId,
      agentId: id,
      includeGaps: hasPermission(auth.role, 'update_sales'),
    })
    if (!map) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    return NextResponse.json({ success: true, map }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[chat/agents/knowledge-map GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar el mapa' }, { status: 500 })
  }
}
