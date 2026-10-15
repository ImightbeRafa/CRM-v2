/**
 * Soft Tenant AI control — Take over / Pause / Resume AI.
 * Client Soft UI also mirrors in localStorage; this endpoint is the server contract
 * for flagged tenants (stores lightweight map under flag.config.agentState).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import { parseConversationKey } from '@/lib/chat-conversation-api'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { sweepWaitingConversation } from '@/lib/soft-ai/waiting-sweep'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

// SecureDog INT-96: resume now triggers an AI answer (model spend) — same-origin + per-person limit.
const controlRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-soft-ai-control' })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ControlAction = 'take_over' | 'pause' | 'resume'

function modeForAction(action: ControlAction): SoftAiAgentMode {
  if (action === 'take_over') return 'human'
  if (action === 'pause') return 'paused'
  if (action === 'resume') return 'ai_active'
  const _exhaustive: never = action
  return _exhaustive
}

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

    const mode = modeForAction(action)
    const db = prisma as any
    const existing = await db.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: SOFT_TENANT_AI_V1_FLAG },
      select: { id: true, enabled: true, config: true },
    })

    const prevConfig =
      existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
        ? (existing.config as Record<string, unknown>)
        : {}
    const agentState =
      prevConfig.agentState && typeof prevConfig.agentState === 'object'
        ? { ...(prevConfig.agentState as Record<string, unknown>) }
        : {}

    agentState[conversationKey] = {
      mode,
      updatedAt: new Date().toISOString(),
      action,
      // Staff-driven controls must be visible to inbound (F37-02 server truth)
      staffControlled: action === 'take_over' || action === 'pause' || action === 'resume',
    }

    const nextConfig = { ...prevConfig, agentState }

    const keyParts = parseConversationKey(conversationKey)
    if (keyParts) {
      await db.chatConversation.updateMany({
        where: {
          tenantId,
          socialAccountId: keyParts.socialAccountId,
          peerId: keyParts.peerId,
        },
        data: { aiMode: mode },
      })
    }

    if (existing?.id) {
      await db.tenantFeatureFlag.update({
        where: { id: existing.id },
        data: { config: nextConfig },
      })
    } else {
      // Control without enabling worker — skeleton row stays disabled
      await db.tenantFeatureFlag.create({
        data: {
          scope: tenantId,
          tenantId,
          key: SOFT_TENANT_AI_V1_FLAG,
          enabled: false,
          config: nextConfig,
        },
      })
    }

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
