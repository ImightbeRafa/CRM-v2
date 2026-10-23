import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/same-origin'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/auditLogger'
import { conversationStorageKey } from '@/lib/chat-soft-copilot'
import { answeredMarkerReady, openAgentHandoffSince, waitingFlags } from '@/lib/chat-unanswered-server'
import { setConversationAgentMode, staffControlledAfter } from '@/lib/chat-agent-control'
import { aiOnLineIds } from '@/lib/soft-ai/agent-inbox-enrich'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** aiMode values a hand-off (or "Tomar control") leaves on the chat. */
const PERSON_MODES = new Set(['human', 'human_takeover'])

/**
 * POST — "Respondido" (Rafael 2026-10-22): a person says this chat in "Sin responder" is handled.
 * - Stamps ChatConversation.answeredAt / answeredByUserId (SQL 063): the chat leaves Sin responder and "Necesita
 *   persona" until the customer writes again or the agent hands it off again (a newer message / turn wins).
 * - If the agent had handed it to a person and that hand-off is still open (no person wrote since, nobody pressed
 *   Tomar control / Pausar after it) and its line answers, the chat goes back to the agent (aiMode ai_active, only if
 *   it is still human), WITHOUT answering the waiting message (unlike "Devolver a IA"): the agent attends the
 *   customer's NEXT message. A person working the chat keeps it. Lines without an active agent: only marked answered.
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

    // A stale screen (a teammate already replied / it is not waiting any more): nothing to mark, nothing to hand back.
    const flags = await waitingFlags(auth.tenantId, [convo.id])
    if (flags.get(convo.id)?.waiting === false) {
      return NextResponse.json({ success: true, alreadyAnswered: true, returnedToAi: false })
    }

    // The row time the person was looking at: a message that reached the server after it stays in Sin responder.
    const body = (await request.json().catch(() => null)) as { seenThrough?: unknown } | null
    const seenMs = typeof body?.seenThrough === 'string' ? Date.parse(body.seenThrough) : NaN
    const seenThrough = Number.isFinite(seenMs) && seenMs <= Date.now() + 60_000 ? new Date(seenMs) : null

    // Decide BEFORE stamping the marker (the open hand-off is read from the same state the person saw).
    const conversationKey = conversationStorageKey(convo.socialAccountId, convo.peerId)
    let handoffSince: Date | null = null
    let lineOn = false
    if (convo.aiMode && PERSON_MODES.has(convo.aiMode)) {
      ;[lineOn, handoffSince] = await Promise.all([
        aiOnLineIds(auth.tenantId, [convo.socialAccountId]).then((ids) => ids.length > 0),
        openAgentHandoffSince(auth.tenantId, convo.id),
      ])
    }

    // Marker: the click time for the audit, and the last customer message it covers in Meta's own clock
    // (answeredThroughAt) so a message stamped a second earlier than the click is never hidden (DATA-RSP-1).
    const at = new Date()
    await prisma.$executeRaw`
      UPDATE "ChatConversation"
      SET "answeredAt" = ${at},
          "answeredByUserId" = ${auth.userId},
          "answeredThroughAt" = LEAST(
            GREATEST(COALESCE("lastInboundAt", "lastMessageAt"), COALESCE(${handoffSince}::timestamp(3), "lastMessageAt")),
            COALESCE(${seenThrough}::timestamp(3), 'infinity'::timestamp)
          ),
          "updatedAt" = ${at}
      WHERE id = ${convo.id} AND "tenantId" = ${auth.tenantId}`

    // Back to the agent only for an OPEN agent hand-off that no person took on after it (INT-RSP-1).
    let returnedToAi = false
    let resumeError = false
    // Not for a hand-off newer than the screen the person saw (it stays with the person, still in Sin responder).
    const sawHandoff = !seenThrough || seenThrough.getTime() >= (handoffSince?.getTime() ?? 0)
    if (lineOn && handoffSince && sawHandoff && !(await staffControlledAfter(auth.tenantId, conversationKey, handoffSince))) {
      try {
        const res = await setConversationAgentMode({
          tenantId: auth.tenantId,
          conversationKey,
          action: 'resume',
          onlyIfAiModeIn: [...PERSON_MODES],
        })
        returnedToAi = res.applied
      } catch {
        // The marker is stored: still audited below; the chat simply stays with the person.
        resumeError = true
      }
    }

    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatConversation',
      entityId: convo.id,
      description: returnedToAi ? 'Chat marcado como respondido y devuelto al agente' : 'Chat marcado como respondido',
      oldValues: { aiMode: convo.aiMode },
      newValues: { answeredAt: at.toISOString(), returnedToAi, resumeError, aiMode: returnedToAi ? 'ai_active' : convo.aiMode },
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
