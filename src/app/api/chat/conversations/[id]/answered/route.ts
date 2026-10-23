import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/same-origin'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/auditLogger'
import { conversationStorageKey } from '@/lib/chat-soft-copilot'
import { agentHandoffOpen, answeredMarkerReady } from '@/lib/chat-unanswered-server'
import { setConversationAgentMode } from '@/lib/chat-agent-control'
import { aiOnLineIds } from '@/lib/soft-ai/agent-inbox-enrich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** aiMode values a hand-off (or "Tomar control") leaves on the chat. */
const PERSON_MODES = new Set(['human', 'human_takeover'])

/**
 * POST — "Respondido" (Rafael 2026-10-22): a person says this chat in "Sin responder" is handled.
 * - Stamps ChatConversation.answeredAt / answeredByUserId (SQL 062): the chat leaves Sin responder and "Necesita
 *   persona" until the customer writes again or the agent hands it off again (a newer message / turn wins).
 * - If the agent had handed it to a person (latest real turn = hand-off) and its line answers, the chat goes back to
 *   the agent (aiMode ai_active), WITHOUT answering the waiting message (unlike "Devolver a IA"): the agent attends
 *   the customer's NEXT message. Lines without an active agent: only marked answered.
 * - Audited (who, when, whether it went back to the agent).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await workspaceWriteRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Demasiados cambios seguidos. Esperá un momento.' },
        { status: 429, headers: rate.headers },
      )
    }
    const { id } = await context.params
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      return NextResponse.json({ success: false, error: 'Chat no encontrado' }, { status: 404 })
    }
    if (!(await answeredMarkerReady())) {
      return NextResponse.json({ success: false, error: 'Respondido todavía no está disponible.' }, { status: 409 })
    }
    const convo = await prisma.chatConversation.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true, socialAccountId: true, peerId: true, aiMode: true, peerName: true },
    })
    if (!convo) return NextResponse.json({ success: false, error: 'Chat no encontrado' }, { status: 404 })

    const at = new Date()
    await prisma.$executeRaw`
      UPDATE "ChatConversation"
      SET "answeredAt" = ${at}, "answeredByUserId" = ${auth.userId}, "updatedAt" = ${at}
      WHERE id = ${convo.id} AND "tenantId" = ${auth.tenantId}`

    // Back to the agent only when the agent itself handed it over and its line still answers.
    let returnedToAi = false
    if (convo.aiMode && PERSON_MODES.has(convo.aiMode)) {
      const [lineOn, handoff] = await Promise.all([
        aiOnLineIds(auth.tenantId, [convo.socialAccountId]).then((ids) => ids.length > 0),
        agentHandoffOpen(auth.tenantId, convo.id),
      ])
      if (lineOn && handoff) {
        await setConversationAgentMode({
          tenantId: auth.tenantId,
          conversationKey: conversationStorageKey(convo.socialAccountId, convo.peerId),
          action: 'resume',
        })
        returnedToAi = true
      }
    }

    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatConversation',
      entityId: convo.id,
      description: returnedToAi ? 'Chat marcado como respondido y devuelto al agente' : 'Chat marcado como respondido',
      oldValues: { aiMode: convo.aiMode },
      newValues: { answeredAt: at.toISOString(), returnedToAi, aiMode: returnedToAi ? 'ai_active' : convo.aiMode },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})

    return NextResponse.json({ success: true, answeredAt: at.toISOString(), returnedToAi })
  } catch (error) {
    console.error('[chat/conversations/answered POST]', { code: error instanceof Error ? error.name : 'error' })
    return NextResponse.json({ success: false, error: 'No se pudo marcar como respondido' }, { status: 500 })
  }
}
