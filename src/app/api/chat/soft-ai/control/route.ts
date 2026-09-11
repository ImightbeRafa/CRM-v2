/**
 * Soft Tenant AI control — Take over / Pause / Resume AI.
 * Client Soft UI also mirrors in localStorage; this endpoint is the server contract
 * for flagged tenants (stores lightweight map under flag.config.agentState).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'

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

    return NextResponse.json({ success: true, conversationKey, action, mode })
  } catch (error) {
    console.error('[soft-ai/control]', error)
    return NextResponse.json({ success: false, error: 'Error al controlar Soft AI' }, { status: 500 })
  }
}
