/**
 * POST /api/chat/agents/feedback — staff thumbs on an agent turn (feeds the agent scorecard).
 * tenantId comes from the session; the turn must belong to it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseFeedbackInput } from '@/lib/soft-ai/agent-scorecard'
import { submitAgentFeedback } from '@/lib/soft-ai/agent-improvement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const body = await request.json().catch(() => null)
    const parsed = parseFeedbackInput(body)
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    }
    const result = await submitAgentFeedback({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      turnId: parsed.turnId,
      rating: parsed.rating,
      reasonCode: parsed.reasonCode,
      note: parsed.note,
    })
    if (!result.ok) {
      if (result.code === 'TURN_NOT_FOUND') {
        return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
      }
      return NextResponse.json(
        { success: false, error: 'La calificación todavía no está disponible.', code: 'NOT_READY' },
        { status: 503 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[chat/agents/feedback POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al guardar' }, { status: 500 })
  }
}
