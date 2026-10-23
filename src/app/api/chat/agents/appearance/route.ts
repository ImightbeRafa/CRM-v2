/**
 * GET/PUT /api/chat/agents/appearance — how each agent looks in the owner UI (plate color, ring,
 * display label). Cosmetic, owner-side only: never sent to customers or to the model.
 * tenantId from the session; PUT needs update_config, same-origin, an agent of this business, and is audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAgentAPI } from '@/lib/support/agent-access'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { AGENT_PLATES, parseAgentAppearance } from '@/lib/agent-appearance'
import { readAgentAppearances, writeAgentAppearance } from '@/lib/agent-appearance-store'

const appearanceRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-agent-appearance' })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAgentAPI(request, 'view_config')
    if (!auth.ok) return auth.response
    const appearances = await readAgentAppearances(auth.tenantId)
    return NextResponse.json({ success: true, appearances }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[chat/agents/appearance GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateAgentAPI(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await appearanceRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const agentId = typeof body?.agentId === 'string' ? body.agentId : ''
    if (!body || !agentId) return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    // Only palette ids, never raw colors.
    if ('plate' in body && !(AGENT_PLATES as readonly unknown[]).includes(body.plate)) {
      return NextResponse.json({ success: false, error: 'Color inválido' }, { status: 400 })
    }
    if ('ring' in body && typeof body.ring !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Valor inválido' }, { status: 400 })
    }
    if ('displayName' in body && body.displayName !== null && typeof body.displayName !== 'string') {
      return NextResponse.json({ success: false, error: 'Nombre inválido' }, { status: 400 })
    }
    const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId: auth.tenantId }, select: { id: true, name: true } })
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    const before = (await readAgentAppearances(auth.tenantId))[agent.id] ?? {}
    const next = { ...before, ...(parseAgentAppearance({ plate: body.plate, ring: body.ring, displayName: body.displayName }) ?? {}) }
    if ('displayName' in body && next.displayName === undefined) next.displayName = null
    const saved = await writeAgentAppearance(auth.tenantId, agent.id, next, auth.userId)
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatAgent',
      entityId: agent.id,
      entityName: agent.name,
      description: 'Apariencia del agente',
      oldValues: before,
      newValues: saved,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, appearance: saved })
  } catch (error) {
    console.error('[chat/agents/appearance PUT]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al guardar' }, { status: 500 })
  }
}
