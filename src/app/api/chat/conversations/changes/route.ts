import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parsePageLimit } from '@/lib/cursor-pagination'
import { mapConversationToListDto, mapMessageToDto } from '@/lib/chat-conversation-api'
import {
  buildConversationChangesWhere,
  parseConversationChangesQuery,
  parseThreadMessageQuery,
} from '@/lib/chat-conversation-query'
import {
  listSelect,
  mapRawConversationRow,
  resolveListPlatformIds,
} from '@/lib/chat-conversation-route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const messageSelect = {
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
} as const

async function loadThreadTail(opts: {
  tenantId: string
  threadId: string
  threadAfter: string | null
  limit: number
}) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: opts.threadId, tenantId: opts.tenantId },
    select: { id: true },
  })
  if (!conversation) return null

  const after = opts.threadAfter
    ? parseThreadMessageQuery(
        new URLSearchParams({ after: opts.threadAfter, limit: String(opts.limit) }),
      ).after
    : null

  const baseWhere = {
    conversationId: conversation.id,
    tenantId: opts.tenantId,
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
      take: opts.limit,
      select: messageSelect,
    })
    return {
      messages: rows.map(mapMessageToDto),
      conversationId: conversation.id,
    }
  }

  // No cursor: return latest page (same shape as messages route default).
  const rows = await prisma.chatMessage.findMany({
    where: baseWhere,
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: opts.limit,
    select: messageSelect,
  })
  return {
    messages: [...rows].reverse().map(mapMessageToDto),
    conversationId: conversation.id,
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(request.url)
    const input = parseConversationChangesQuery(searchParams)
    const limit = parsePageLimit(searchParams.get('limit'), 100, 200)
    const threadId = (searchParams.get('threadId') || '').trim() || null
    const threadAfter = (searchParams.get('threadAfter') || '').trim() || null

    const platformAccountIds = await resolveListPlatformIds(auth.tenantId, input)
    if (input.platform && platformAccountIds && platformAccountIds.length === 0) {
      return NextResponse.json({
        success: true,
        conversations: [],
        nextRevision: input.afterRevision.toString(),
        hasMoreChanges: false,
        maxRevision: input.afterRevision.toString(),
        threadTail: null,
      })
    }

    const where = buildConversationChangesWhere({
      tenantId: auth.tenantId,
      input,
      viewerUserId: auth.userId,
      platformAccountIds,
    })

    const rows = await prisma.chatConversation.findMany({
      where,
      orderBy: [{ revision: 'asc' }],
      take: limit,
      select: {
        ...listSelect,
        readStates: { ...listSelect.readStates, where: { userId: auth.userId } },
      },
    })

    const conversations = rows.map((row) =>
      mapConversationToListDto(mapRawConversationRow(row as Parameters<typeof mapRawConversationRow>[0])),
    )

    // Advance only to last delivered row — never jump to tenant max (skips queued revisions).
    const lastRowRevision =
      rows.length > 0
        ? (rows[rows.length - 1] as { revision: bigint }).revision
        : input.afterRevision
    const hasMoreChanges = rows.length === limit

    let threadTail: {
      conversationId: string
      messages: ReturnType<typeof mapMessageToDto>[]
    } | null = null
    if (threadId) {
      try {
        threadTail = await loadThreadTail({
          tenantId: auth.tenantId,
          threadId,
          threadAfter,
          limit: 50,
        })
      } catch (error) {
        console.warn('[chat/conversations/changes] threadTail failed', error)
        threadTail = null
      }
    }

    return NextResponse.json({
      success: true,
      conversations,
      nextRevision: lastRowRevision.toString(),
      hasMoreChanges,
      // Kept for older clients; v2 client must prefer nextRevision.
      maxRevision: lastRowRevision.toString(),
      threadTail,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    const status = /Invalid/.test(message) ? 400 : 500
    if (status === 500) console.error('[chat/conversations/changes GET]', error)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
