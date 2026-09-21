/**
 * POST /api/chat/agents/[id]/test — Probar (zero Meta)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { probeAgent } from '@/lib/soft-ai/agent-admin'

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
    const inboundText =
      body && typeof body === 'object' && typeof (body as { inboundText?: unknown }).inboundText === 'string'
        ? (body as { inboundText: string }).inboundText.trim()
        : ''
    if (!inboundText) {
      return NextResponse.json({ success: false, error: 'inboundText requerido' }, { status: 400 })
    }
    const socialAccountId =
      body && typeof body === 'object' && typeof (body as { socialAccountId?: unknown }).socialAccountId === 'string'
        ? (body as { socialAccountId: string }).socialAccountId
        : null

    const result = await probeAgent({
      tenantId: auth.tenantId,
      agentId: id,
      inboundText,
      socialAccountId,
      actorUserId: auth.userId,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error'
    if (msg === 'AGENT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/:id/test]', error)
    return NextResponse.json({ success: false, error: 'Error en Probar' }, { status: 500 })
  }
}
