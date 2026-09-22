/**
 * POST /api/chat/agents/[id]/test — Probar (zero Meta)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { probeAgent } from '@/lib/soft-ai/agent-admin'
import { parseAgentTestRequest } from '@/lib/soft-ai/agent-test-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = parseAgentTestRequest(body)
    const result = await probeAgent({
      tenantId: auth.tenantId,
      agentId: id,
      inboundText: parsed.inboundText,
      socialAccountId: parsed.socialAccountId,
      actorUserId: auth.userId,
      testSessionId: parsed.testSessionId,
      messageType: parsed.messageType,
      history: parsed.history,
      windowOpen: parsed.windowOpen,
      customerName: parsed.customerName,
      conversationAiMode: parsed.conversationAiMode,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error'
    if (msg === 'TEST_REQUEST_INVALID') {
      return NextResponse.json({ success: false, error: 'Solicitud de prueba inválida' }, { status: 400 })
    }
    if (msg === 'AGENT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/:id/test]', error)
    return NextResponse.json({ success: false, error: 'Error en Probar' }, { status: 500 })
  }
}
