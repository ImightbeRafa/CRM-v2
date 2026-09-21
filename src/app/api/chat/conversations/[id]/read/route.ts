import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { loadConversationForTenant } from '@/lib/chat-conversation-route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(_request, 'update_sales')
    if (!auth.ok) return auth.response

    const { id } = await context.params
    const conversation = await prisma.chatConversation.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true, inboundCount: true, lastMessageId: true },
    })
    if (!conversation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const now = new Date()
    await prisma.chatConversationReadState.upsert({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: auth.userId,
        },
      },
      create: {
        tenantId: auth.tenantId,
        conversationId: conversation.id,
        userId: auth.userId,
        readInboundCount: conversation.inboundCount,
        lastReadAt: now,
        lastReadMessageId: conversation.lastMessageId,
      },
      update: {
        readInboundCount: conversation.inboundCount,
        lastReadAt: now,
        lastReadMessageId: conversation.lastMessageId,
      },
    })

    const row = await loadConversationForTenant({
      conversationId: conversation.id,
      tenantId: auth.tenantId,
      viewerUserId: auth.userId,
    })

    return NextResponse.json({
      success: true,
      readInboundCount: conversation.inboundCount,
      unreadCount: row ? Math.max(0, row.inboundCount - (row.readInboundCount ?? 0)) : 0,
    })
  } catch (error) {
    console.error('[chat/conversations/read POST]', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
