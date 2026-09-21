import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  mapConversationToListDto,
  patchConversationBodySchema,
} from '@/lib/chat-conversation-api'
import { isActiveTenantMember, loadConversationForTenant } from '@/lib/chat-conversation-route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

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

    if (body.assignedUserId) {
      const ok = await isActiveTenantMember(auth.tenantId, body.assignedUserId)
      if (!ok) {
        return NextResponse.json({ success: false, error: 'Invalid assignee' }, { status: 400 })
      }
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
      conversation: mapConversationToListDto(row),
    })
  } catch (error) {
    console.error('[chat/conversations PATCH]', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
