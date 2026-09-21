/**
 * POST /api/chat/agents/[id]/bindings — bind/unbind SocialAccount
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  listAgentChannels,
  setAgentBinding,
  setAgentChannelConfiguration,
} from '@/lib/soft-ai/agent-admin'

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
    const result = await listAgentChannels(auth.tenantId, id)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error'
    if (msg === 'AGENT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/:id/bindings GET]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
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
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    const socialAccountId = String((body as { socialAccountId?: unknown }).socialAccountId || '')
    const record = body as { active?: unknown; activeBinding?: unknown; aiAllowed?: unknown }
    if (typeof record.aiAllowed === 'boolean' || typeof record.activeBinding === 'boolean') {
      const result = await setAgentChannelConfiguration({
        tenantId: auth.tenantId,
        agentId: id,
        socialAccountId,
        activeBinding: record.activeBinding !== false,
        aiAllowed: record.aiAllowed === true,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
      })
      return NextResponse.json({ success: true, result })
    }
    const active = record.active !== false
    if (!socialAccountId) {
      return NextResponse.json({ success: false, error: 'socialAccountId requerido' }, { status: 400 })
    }
    const result = await setAgentBinding({
      tenantId: auth.tenantId,
      agentId: id,
      socialAccountId,
      active,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
    })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error'
    if (msg === 'AGENT_NOT_FOUND' || msg === 'SOCIAL_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/:id/bindings]', error)
    return NextResponse.json({ success: false, error: 'Error al vincular' }, { status: 500 })
  }
}
