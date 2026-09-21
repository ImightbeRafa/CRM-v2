/**
 * PATCH /api/chat/agents/[id] — update agent (update_config)
 * GET — agent detail + audit history
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  listAgentAudit,
  updateChatAgent,
  mapChatAgentAdminError,
} from '@/lib/soft-ai/agent-admin'
import { prisma } from '@/lib/db'
import { isChatAgentSchemaReady } from '@/lib/soft-ai/agent-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    if (!(await isChatAgentSchemaReady())) {
      return NextResponse.json({ success: false, schemaReady: false }, { status: 503 })
    }
    const { id } = await context.params
    const agent = await prisma.chatAgent.findFirst({
      where: { id, tenantId: auth.tenantId },
      include: {
        bindings: {
          where: { isActive: true },
          select: { id: true, scope: true, socialAccountId: true, isActive: true },
        },
      },
    })
    if (!agent) {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    const history = await listAgentAudit(auth.tenantId, id, 20)
    return NextResponse.json({ success: true, agent, history })
  } catch (error) {
    console.error('[chat/agents/:id GET]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}

export async function PATCH(
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
    const patch = body as Record<string, unknown>
    const agent = await updateChatAgent({
      tenantId: auth.tenantId,
      agentId: id,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      patch: {
        name: typeof patch.name === 'string' ? patch.name : undefined,
        emoji: typeof patch.emoji === 'string' ? patch.emoji : undefined,
        description:
          patch.description === null
            ? null
            : typeof patch.description === 'string'
              ? patch.description
              : undefined,
        systemInstructions:
          typeof patch.systemInstructions === 'string'
            ? patch.systemInstructions
            : undefined,
        tonePreset: patch.tonePreset as 'warm_concise' | 'formal' | 'playful' | undefined,
        operationMode: patch.operationMode as
          | 'ai_full'
          | 'ai_suggest'
          | 'human_only'
          | undefined,
        enabledTools: Array.isArray(patch.enabledTools)
          ? patch.enabledTools.filter((t): t is string => typeof t === 'string')
          : undefined,
        status: patch.status as 'draft' | 'live' | 'archived' | undefined,
        model: typeof patch.model === 'string' ? patch.model : undefined,
      },
    })
    return NextResponse.json({ success: true, agent })
  } catch (error) {
    const mapped = mapChatAgentAdminError(error)
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    console.error('[chat/agents/:id PATCH]', error)
    return NextResponse.json({ success: false, error: 'Error al actualizar' }, { status: 500 })
  }
}
