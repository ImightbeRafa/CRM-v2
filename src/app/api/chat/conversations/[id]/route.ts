import { NextRequest, NextResponse } from 'next/server'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/auditLogger'
import { recordActivity } from '@/lib/activity'
import { isAllowedChatStage, loadStages, loadTags } from '@/lib/crm-stages-server'
import { allowedChatTagKeys, isBuiltinChatTag, isClosedCategory, PAYMENT_REVIEW_TAG, stageCategoryOf } from '@/lib/crm-stages'
import { markClosed } from '@/lib/chat-workspace-sweep'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  mapConversationToListDto,
  patchConversationBodySchema,
  CHAT_TAGS_MAX,
} from '@/lib/chat-conversation-api'
import { isAssignableChatMember, loadConversationForTenant } from '@/lib/chat-conversation-route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const rate = await workspaceWriteRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados cambios seguidos. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }

    const { id } = await context.params
    const existing = await loadConversationForTenant({
      conversationId: id,
      tenantId: auth.tenantId,
      viewerUserId: auth.userId,
    })
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const json = await request.json().catch(() => null)
    const parsed = patchConversationBodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const body = parsed.data
    if (body.status !== undefined && !(await isAllowedChatStage(auth.tenantId, body.status))) {
      return NextResponse.json({ success: false, error: 'Etapa inválida para este negocio' }, { status: 400 })
    }
    if (body.tags !== undefined) {
      // New tags must come from the business's catalog (Config › Chats, update_config); tags the
      // chat already has may stay (e.g. one archived later). SecureDog DATA-07. The built-in review
      // tags ('Pago por verificar' / 'Pedido por confirmar') are always valid (agents2-notify).
      const allowed = allowedChatTagKeys((await loadTags(auth.tenantId)).tags)
      const had = new Set(existing.tags ?? [])
      const unknown = body.tags.filter((t) => !allowed.has(t) && !had.has(t))
      if (unknown.length) {
        return NextResponse.json({ success: false, error: 'Etiqueta inválida para este negocio' }, { status: 400 })
      }
    }
    // SecureDog DATA-53: a single tag added must come from the catalog (or be a built-in review tag),
    // unless the chat already has it (then it is a no-op).
    if (body.addTag !== undefined && !(existing.tags ?? []).includes(body.addTag)) {
      const allowed = allowedChatTagKeys((await loadTags(auth.tenantId)).tags)
      if (!allowed.has(body.addTag)) {
        return NextResponse.json({ success: false, error: 'Etiqueta inválida para este negocio' }, { status: 400 })
      }
    }

    if (body.assignedUserId) {
      const ok = await isAssignableChatMember(auth.tenantId, body.assignedUserId)
      if (!ok) {
        return NextResponse.json({ success: false, error: 'Invalid assignee' }, { status: 400 })
      }
    }

    // agents2-notify: one tag out, atomically in the database (array_remove), scoped to this business —
    // a concurrent AI-added tag or a teammate's change is never overwritten by a stale client array.
    // SecureDog DATA-53: one tag in, atomically (array_append only when absent and under the 20-tag cap).
    let addedTag = false
    if (body.addTag !== undefined) {
      const n = await prisma.$executeRaw`
        UPDATE public."ChatConversation"
           SET "tags" = array_append("tags", ${body.addTag})
         WHERE "id" = ${existing.id} AND "tenantId" = ${auth.tenantId}
           AND NOT (${body.addTag} = ANY("tags")) AND cardinality("tags") < ${CHAT_TAGS_MAX}`
      addedTag = n > 0
      if (!addedTag) {
        const now = await prisma.chatConversation.findFirst({ where: { id: existing.id, tenantId: auth.tenantId }, select: { tags: true } })
        if (!now?.tags.includes(body.addTag)) {
          return NextResponse.json({ success: false, error: `Máximo ${CHAT_TAGS_MAX} etiquetas por chat` }, { status: 400 })
        }
      }
    }

    let removedTag = false
    if (body.removeTag !== undefined) {
      const n = await prisma.$executeRaw`
        UPDATE public."ChatConversation"
           SET "tags" = array_remove("tags", ${body.removeTag})
         WHERE "id" = ${existing.id} AND "tenantId" = ${auth.tenantId} AND ${body.removeTag} = ANY("tags")`
      removedTag = n > 0
    }

    const updated = await prisma.chatConversation.update({
      where: { id: existing.id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.assignedUserId !== undefined
          ? { assignedUserId: body.assignedUserId }
          : {}),
        ...(body.aiMode !== undefined ? { aiMode: body.aiMode } : {}),
      },
      select: { id: true },
    })

    if (body.assignedUserId !== undefined && body.assignedUserId !== existing.assignedUserId) {
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatConversation',
        entityId: existing.id,
        description: body.assignedUserId ? 'Chat asignado' : 'Chat sin asignar',
        oldValues: { assignedUserId: existing.assignedUserId },
        newValues: { assignedUserId: body.assignedUserId },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
    }

    // Human action log (Phase 2a): one event per changed field, ids / short enums only.
    const base = { tenantId: auth.tenantId, actorUserId: auth.userId, conversationId: existing.id, entityType: 'ChatConversation', entityId: existing.id, surface: 'chats' }
    if (body.status !== undefined && body.status !== existing.status) {
      void recordActivity({ ...base, verb: 'chat.stage.set', props: { from: existing.status ?? null, to: body.status } })
      // Phase 2b: remember when a human closed it (reopen-on-inbound compares against this).
      const closedNow = isClosedCategory(stageCategoryOf((await loadStages(auth.tenantId, 'chat')).stages, body.status))
      await markClosed(auth.tenantId, existing.id, closedNow ? 'human' : null)
    }
    if (body.tags !== undefined) {
      const before = new Set(existing.tags ?? [])
      const after = new Set(body.tags)
      const added = [...after].filter((t) => !before.has(t))
      const removed = [...before].filter((t) => !after.has(t))
      if (added.length || removed.length) {
        void recordActivity({ ...base, verb: 'chat.tags.set', props: { added: added.join(',').slice(0, 80), removed: removed.join(',').slice(0, 80) } })
      }
    }
    if (removedTag || addedTag) {
      void recordActivity({
        ...base,
        verb: 'chat.tags.set',
        props: { added: addedTag ? String(body.addTag).slice(0, 80) : '', removed: removedTag ? String(body.removeTag).slice(0, 80) : '' },
      })
    }
    // SecureDog DATA-53: clearing "Pago por verificar" / "Pedido por confirmar" is a money decision — audit it
    // (who, which chat, which tag), whichever way it was removed.
    const builtinRemoved = [
      ...(removedTag && isBuiltinChatTag(body.removeTag) ? [body.removeTag as string] : []),
      ...(body.tags !== undefined ? (existing.tags ?? []).filter((t) => isBuiltinChatTag(t) && !body.tags!.includes(t)) : []),
    ]
    for (const tag of builtinRemoved) {
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatConversation',
        entityId: existing.id,
        description: tag === PAYMENT_REVIEW_TAG ? 'Pago marcado como verificado' : 'Pedido marcado como confirmado',
        oldValues: { tag },
        newValues: { tagRemoved: tag, conversationId: existing.id },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
    }
    if (body.assignedUserId !== undefined && body.assignedUserId !== existing.assignedUserId) {
      void recordActivity({ ...base, verb: 'chat.assign', props: { to: body.assignedUserId ?? null } })
    }
    if (body.aiMode !== undefined && body.aiMode !== existing.aiMode) {
      void recordActivity({ ...base, verb: 'chat.ai_mode.set', props: { from: existing.aiMode ?? null, to: body.aiMode } })
      await logAuditEvent({
        action: 'UPDATE',
        entityType: 'ChatConversation',
        entityId: existing.id,
        description: 'Modo de IA del chat cambiado',
        oldValues: { aiMode: existing.aiMode },
        newValues: { aiMode: body.aiMode },
        userId: auth.userId,
        userRole: auth.role,
        tenantId: auth.tenantId,
      }).catch(() => {})
    }

    const row = await loadConversationForTenant({
      conversationId: updated.id,
      tenantId: auth.tenantId,
      viewerUserId: auth.userId,
    })
    if (!row) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      conversation: mapConversationToListDto(row, (await loadStages(auth.tenantId, 'chat')).stages),
    })
  } catch (error) {
    console.error('[chat/conversations PATCH]', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
