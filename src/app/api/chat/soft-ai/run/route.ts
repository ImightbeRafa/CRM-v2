/**
 * Soft Tenant AI — run one agent turn (feature-flagged).
 * DEMO clients call the pure worker locally; this route is for real tenants.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { shouldUseSoftTenantAiV1, readSoftTenantAiConfig } from '@/lib/feature-flags'
import { parseSoftAiConfig } from '@/lib/soft-ai/config'
import { runSoftAiTurn } from '@/lib/soft-ai/worker'
import { buildSoftAiServerDeps } from '@/lib/soft-ai/server-deps'
import type { SoftAiAgentMode, SoftAiTurnMessage } from '@/lib/soft-ai/types'
import type { SoftTag } from '@/lib/chat-soft-copilot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { tenantId } = auth
    const enabled = await shouldUseSoftTenantAiV1(tenantId)
    const body = await request.json().catch(() => null)
    const demo = Boolean(body?.demo)

    if (!enabled && !demo) {
      return NextResponse.json(
        { success: false, error: 'Soft Tenant AI desactivado para este tenant', skipped: true },
        { status: 403 },
      )
    }

    const flag = await readSoftTenantAiConfig(tenantId)
    const config = parseSoftAiConfig(flag.config)

    const messages = Array.isArray(body?.messages)
      ? (body.messages as SoftAiTurnMessage[])
      : []
    const agentMode = (['ai_active', 'paused', 'human'].includes(body?.agentMode)
      ? body.agentMode
      : 'ai_active') as SoftAiAgentMode
    const tags = Array.isArray(body?.tags) ? (body.tags as SoftTag[]) : []

    const result = await runSoftAiTurn(
      {
        conversationKey: String(body?.conversationKey || 'unknown'),
        recipientId: String(body?.recipientId || ''),
        recipientName: body?.recipientName ? String(body.recipientName) : null,
        platform: String(body?.platform || 'whatsapp'),
        messages,
        inboundText: body?.inboundText ? String(body.inboundText) : undefined,
        agentMode,
        config,
        tags,
        orderId: body?.orderId ? String(body.orderId) : null,
        demo,
      },
      demo ? undefined : buildSoftAiServerDeps(tenantId),
    )

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('[soft-ai/run]', error)
    return NextResponse.json({ success: false, error: 'Error al ejecutar Soft AI' }, { status: 500 })
  }
}
