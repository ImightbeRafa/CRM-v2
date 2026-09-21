/**
 * POST /api/chat/agents/[id]/panic — Pausar canal / Solo humanos / Quitar de la lista
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  panicHumanOnly,
  panicPauseChannel,
  panicRemoveAllowlist,
} from '@/lib/soft-ai/agent-admin'
import { FORGE_WA_SOCIAL_ACCOUNT_ID } from '@/lib/soft-ai/agent-types'

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
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    const action = String((body as { action?: unknown }).action || '')
    const socialAccountId =
      typeof (body as { socialAccountId?: unknown }).socialAccountId === 'string'
        ? (body as { socialAccountId: string }).socialAccountId
        : FORGE_WA_SOCIAL_ACCOUNT_ID

    if (action === 'pause_channel') {
      const result = await panicPauseChannel({
        tenantId: auth.tenantId,
        socialAccountId,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
      })
      return NextResponse.json({ success: true, result })
    }
    if (action === 'human_only') {
      const agent = await panicHumanOnly({
        tenantId: auth.tenantId,
        agentId: id,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
      })
      return NextResponse.json({ success: true, agent })
    }
    if (action === 'remove_allowlist') {
      const config = await panicRemoveAllowlist({
        tenantId: auth.tenantId,
        socialAccountId,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
      })
      return NextResponse.json({ success: true, config })
    }
    return NextResponse.json({ success: false, error: 'Acción inválida' }, { status: 400 })
  } catch (error) {
    console.error('[chat/agents/:id/panic]', error)
    return NextResponse.json({ success: false, error: 'Error en panic' }, { status: 500 })
  }
}
