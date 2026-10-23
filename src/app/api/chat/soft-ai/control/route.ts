/**
 * Soft Tenant AI control — Take over / Pause / Resume AI.
 * Client Soft UI also mirrors in localStorage; this endpoint is the server contract
 * for flagged tenants (stores lightweight map under flag.config.agentState).
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { setConversationAgentMode, type AgentControlAction } from '@/lib/chat-agent-control'
import { sweepWaitingConversation } from '@/lib/soft-ai/waiting-sweep'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

// SecureDog INT-96: resume now triggers an AI answer (model spend) — same-origin + per-person limit.
const controlRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-soft-ai-control' })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ControlAction = AgentControlAction

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await controlRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados intentos. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }

    const { tenantId } = auth
    const body = await request.json().catch(() => null)
    const action = body?.action as ControlAction
    const conversationKey = body?.conversationKey ? String(body.conversationKey) : ''

    if (!conversationKey || !['take_over', 'pause', 'resume'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'action (take_over|pause|resume) y conversationKey requeridos' },
        { status: 400 },
      )
    }

    const { mode, keyParts } = await setConversationAgentMode({ tenantId, conversationKey, action })

    // Devolver a IA: if the customer's last message is still unanswered (and the line answers), answer it now.
    // Same job path as the webhook (same delivery key), so it is never answered twice.
    let answering = false
    if (action === 'resume' && keyParts) {
      const sweep = await sweepWaitingConversation({
        tenantId,
        socialAccountId: keyParts.socialAccountId,
        peerId: keyParts.peerId,
      })
      answering = sweep.queued
    }

    return NextResponse.json({ success: true, conversationKey, action, mode, answering })
  } catch (error) {
    console.error('[soft-ai/control]', error)
    return NextResponse.json({ success: false, error: 'Error al controlar Soft AI' }, { status: 500 })
  }
}
