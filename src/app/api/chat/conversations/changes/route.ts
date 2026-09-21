import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parsePageLimit } from '@/lib/cursor-pagination'
import { mapConversationToListDto } from '@/lib/chat-conversation-api'
import {
  buildConversationChangesWhere,
  parseConversationChangesQuery,
} from '@/lib/chat-conversation-query'
import {
  listSelect,
  mapRawConversationRow,
  resolveListPlatformIds,
} from '@/lib/chat-conversation-route-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(request.url)
    const input = parseConversationChangesQuery(searchParams)
    const limit = parsePageLimit(searchParams.get('limit'), 100, 200)

    const platformAccountIds = await resolveListPlatformIds(auth.tenantId, input)
    if (input.platform && platformAccountIds && platformAccountIds.length === 0) {
      return NextResponse.json({
        success: true,
        conversations: [],
        maxRevision: input.afterRevision.toString(),
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

    const maxRevisionAgg = await prisma.chatConversation.aggregate({
      where: { tenantId: auth.tenantId },
      _max: { revision: true },
    })
    const maxRevision = maxRevisionAgg._max.revision ?? input.afterRevision

    return NextResponse.json({
      success: true,
      conversations,
      maxRevision: maxRevision.toString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    const status = /Invalid/.test(message) ? 400 : 500
    if (status === 500) console.error('[chat/conversations/changes GET]', error)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
