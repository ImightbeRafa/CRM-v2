/**
 * GET/POST /api/chat/agents/[id]/eval — automatic safety test run for an agent (no tokens, no sends).
 * POST runs the frozen fixture set through the agent's deterministic safety layer and stores the result
 * against the agent's current version; GET lists the latest runs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { loadLatestEvalRuns, runAgentSafetyEval } from '@/lib/soft-ai/agent-improvement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const runs = await loadLatestEvalRuns(auth.tenantId, id)
    return NextResponse.json({ success: true, runs })
  } catch (error) {
    console.error('[chat/agents/eval GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const result = await runAgentSafetyEval({
      tenantId: auth.tenantId,
      agentId: id,
      actorUserId: auth.userId,
    })
    if (!result.ok) {
      return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    }
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[chat/agents/eval POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al ejecutar las pruebas' }, { status: 500 })
  }
}
