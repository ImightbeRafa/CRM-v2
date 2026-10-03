/**
 * POST /api/chat/agents/[id]/test — Probar (zero Meta)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { probeAgent } from '@/lib/soft-ai/agent-admin'
import { parseAgentTestRequest } from '@/lib/soft-ai/agent-test-schema'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Every Probar turn can call a paid model: bound the pace per business member.
const probarRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 30, identifier: 'chat-agent-test' })

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const rate = await probarRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Demasiadas pruebas seguidas. Esperá un momento.' },
        { status: 429, headers: rate.headers },
      )
    }
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
      modelOverride: parsed.modelOverride,
    })
    // Provider cost in dollars stays on the platform side (never shown to businesses).
    const { estimatedCostUsd: _platformOnlyCost, ...visible } = result as typeof result & { estimatedCostUsd?: number }
    void _platformOnlyCost
    return NextResponse.json({ success: true, ...visible })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error'
    if (msg === 'TEST_REQUEST_INVALID') {
      return NextResponse.json({ success: false, error: 'Solicitud de prueba inválida' }, { status: 400 })
    }
    if (msg === 'MODEL_PROVIDER_NOT_CONFIGURED') {
      return NextResponse.json(
        { success: false, error: 'Ese modelo todavía no está configurado en el servidor.' },
        { status: 409 },
      )
    }
    if (msg === 'PROBAR_BUSY') {
      return NextResponse.json(
        { success: false, error: 'Hay varias pruebas en curso para este negocio. Esperá a que terminen.' },
        { status: 429 },
      )
    }
    if (msg === 'AGENT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/:id/test]', error)
    return NextResponse.json({ success: false, error: 'Error en Probar' }, { status: 500 })
  }
}
