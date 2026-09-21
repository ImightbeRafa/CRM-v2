import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { mapMessageToDto } from '@/lib/chat-conversation-api'
import { parseThreadMessageQuery } from '@/lib/chat-conversation-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { id } = await context.params
    const conversation = await prisma.chatConversation.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true },
    })
    if (!conversation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const { before, after, limit } = parseThreadMessageQuery(searchParams)

    const baseWhere = {
      conversationId: conversation.id,
      tenantId: auth.tenantId,
      duplicateOfMessageId: null,
    }

    if (after) {
      const rows = await prisma.chatMessage.findMany({
        where: {
          ...baseWhere,
          OR: [
            { sentAt: { gt: after.sentAt } },
            { sentAt: after.sentAt, id: { gt: after.id } },
          ],
        },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: {
          id: true,
          direction: true,
          content: true,
          sentAt: true,
          receivedAt: true,
          deliveryStatus: true,
          messageType: true,
          clientId: true,
          orderId: true,
          metadata: true,
          providerMediaId: true,
          mediaMimeType: true,
          mediaFilename: true,
        },
      })
      return NextResponse.json({
        success: true,
        messages: rows.map(mapMessageToDto),
        nextBefore: null,
        nextAfter:
          rows.length === limit
            ? `${rows[rows.length - 1]!.sentAt.toISOString()},${rows[rows.length - 1]!.id}`
            : null,
      })
    }

    const rows = await prisma.chatMessage.findMany({
      where: before
        ? {
            ...baseWhere,
            OR: [
              { sentAt: { lt: before.sentAt } },
              { sentAt: before.sentAt, id: { lt: before.id } },
            ],
          }
        : baseWhere,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        direction: true,
        content: true,
        sentAt: true,
        receivedAt: true,
        deliveryStatus: true,
        messageType: true,
        clientId: true,
        orderId: true,
        metadata: true,
        providerMediaId: true,
        mediaMimeType: true,
        mediaFilename: true,
      },
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const ordered = [...page].reverse()
    const oldest = ordered[0]

    return NextResponse.json({
      success: true,
      messages: ordered.map(mapMessageToDto),
      nextBefore:
        hasMore && oldest
          ? `${oldest.sentAt.toISOString()},${oldest.id}`
          : null,
      nextAfter: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    const status = /Invalid/.test(message) ? 400 : 500
    if (status === 500) console.error('[chat/conversations/messages GET]', error)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
