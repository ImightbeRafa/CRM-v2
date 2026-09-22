/**
 * POST /api/chat/agents/[id]/test/unlock — audited real-send approval.
 * Body: { socialAccountId }. Refusals are HTTP 400 with a stable code.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  agentUnlockHttpError,
  approveAgentAiFullUnlock,
  isAgentUnlockRefusal,
} from '@/lib/soft-ai/agent-unlock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function actorName(auth: {
  userId: string
  session: { user?: { name?: string | null; email?: string | null } } | null
}): string {
  const name = auth.session?.user?.name?.trim()
  if (name) return name
  const email = auth.session?.user?.email?.trim()
  if (email) return email
  return auth.userId
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const socialAccountId =
      body && typeof body === 'object' && !Array.isArray(body)
        ? String((body as { socialAccountId?: unknown }).socialAccountId || '')
        : ''
    const result = await approveAgentAiFullUnlock({
      tenantId: auth.tenantId,
      agentId: id,
      socialAccountId,
      actorUserId: auth.userId,
      actorName: actorName(auth),
      actorRole: String(auth.role),
    })
    return NextResponse.json({
      success: true,
      record: result.record,
      bindingScope: result.bindingScope,
      agentName: result.agentName,
      approvedByName: actorName(auth),
    })
  } catch (error) {
    if (isAgentUnlockRefusal(error)) {
      const http = agentUnlockHttpError(error.code)
      return NextResponse.json(http.body, { status: http.status })
    }
    const msg = error instanceof Error ? error.message : 'error'
    if (msg === 'AGENT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/:id/test/unlock]', error)
    return NextResponse.json({ success: false, error: 'No se pudo aprobar el envío' }, { status: 500 })
  }
}
