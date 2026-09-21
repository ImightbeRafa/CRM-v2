/**
 * GET/POST /api/chat/agents — list + create ChatAgent
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission, type Role } from '@/lib/rbac'
import {
  createChatAgent,
  listChatAgents,
  ensurePilotDefaults,
  mapChatAgentAdminError,
} from '@/lib/soft-ai/agent-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response

    const result = await listChatAgents(auth.tenantId)
    return NextResponse.json({
      success: true,
      schemaReady: result.schemaReady,
      agents: result.agents,
      canEdit: hasPermission(auth.role as Role, 'update_config'),
    })
  } catch (error) {
    console.error('[chat/agents GET]', error)
    const mapped = mapChatAgentAdminError(error)
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    return NextResponse.json({ success: false, error: 'Error al listar agentes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    const rec = body as Record<string, unknown>

    if (rec.bootstrapPilot === true) {
      const result = await ensurePilotDefaults({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
      })
      if (!result.ok) {
        if (result.reason === 'schema_not_ready') {
          return NextResponse.json(
            {
              success: false,
              error: 'SQL 027 aún no aplicado — no se pueden sembrar agentes todavía',
              schemaReady: false,
              code: 'SCHEMA_NOT_READY',
            },
            { status: 503 },
          )
        }
        return NextResponse.json(
          { success: false, error: 'No se pudo sembrar el piloto', reason: result.reason },
          { status: 500 },
        )
      }
      return NextResponse.json({ success: true, ...result })
    }

    const name = typeof rec.name === 'string' ? rec.name : ''
    if (!name.trim()) {
      return NextResponse.json(
        { success: false, error: 'Nombre requerido', code: 'NAME_REQUIRED' },
        { status: 400 },
      )
    }

    const agent = await createChatAgent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      name,
      emoji: typeof rec.emoji === 'string' ? rec.emoji : undefined,
      description: typeof rec.description === 'string' ? rec.description : null,
      systemInstructions:
        typeof rec.systemInstructions === 'string' ? rec.systemInstructions : undefined,
      tonePreset: rec.tonePreset as 'warm_concise' | 'formal' | 'playful' | undefined,
      introductionNames: Array.isArray(body.introductionNames) ? body.introductionNames : undefined,
      enabledTools: Array.isArray(rec.enabledTools)
        ? rec.enabledTools.filter((t): t is string => typeof t === 'string')
        : undefined,
    })

    return NextResponse.json({ success: true, agent })
  } catch (error) {
    const mapped = mapChatAgentAdminError(error)
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
    console.error('[chat/agents POST]', error)
    return NextResponse.json({ success: false, error: 'Error al crear agente' }, { status: 500 })
  }
}
