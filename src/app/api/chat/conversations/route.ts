import { NextRequest, NextResponse } from 'next/server'
import { enrichConversationDtosWithLinkedOrders } from '@/lib/chat-linked-orders'
import { attachSnoozeState, listSnoozedConversationIds, probeWorkState, workStateKnownMissing } from '@/lib/chat-work-state-server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  decodeTimestampCursor,
  encodeTimestampCursor,
  parsePageLimit,
} from '@/lib/cursor-pagination'
import { mapConversationToListDto } from '@/lib/chat-conversation-api'
import { enrichConversationDtosWithAgents } from '@/lib/soft-ai/agent-inbox-enrich'
import {
  buildConversationListWhere,
  conversationListCursorScope,
  parseConversationListQuery,
} from '@/lib/chat-conversation-query'
import {
  listSelect,
  mapRawConversationRow,
  resolveListPlatformIds,
} from '@/lib/chat-conversation-route-helpers'
import { loadStages } from '@/lib/crm-stages-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(request.url)
    const input = parseConversationListQuery(searchParams)
    const limit = parsePageLimit(searchParams.get('limit'), 30, 50)
    const scope = conversationListCursorScope(auth.tenantId, input)
    const cursor = decodeTimestampCursor(searchParams.get('cursor'), scope)

    const platformAccountIds = await resolveListPlatformIds(auth.tenantId, input)
    if (input.platform && platformAccountIds && platformAccountIds.length === 0) {
      return NextResponse.json({ success: true, conversations: [], nextCursor: null, maxRevision: '0' })
    }

    // Pospuestos: only this business's chats snoozed right now (they can be far down the list).
    const restrictIds = input.snoozed ? await listSnoozedConversationIds(auth.tenantId) : null
    if (restrictIds && restrictIds.length === 0) {
      return NextResponse.json({ success: true, conversations: [], nextCursor: null, maxRevision: '0', snoozeAvailable: !workStateKnownMissing() })
    }

    const baseWhere = buildConversationListWhere({
      tenantId: auth.tenantId,
      input,
      viewerUserId: auth.userId,
      platformAccountIds,
      restrictIds,
    })

    const where = cursor
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { lastMessageAt: { lt: new Date(cursor.timestamp) } },
                {
                  lastMessageAt: new Date(cursor.timestamp),
                  id: { lt: cursor.id },
                },
              ],
            },
          ],
        }
      : baseWhere

    // The max revision is read strictly BEFORE the page: a change landing in between has a higher
    // revision, so /changes re-sends it (never skipped). The page and the stages then run together.
    const maxRevisionAgg = await prisma.chatConversation.aggregate({
      where: { tenantId: auth.tenantId },
      _max: { revision: true },
    })
    const [rows, { stages: chatStages }] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          ...listSelect,
          readStates: { ...listSelect.readStates, where: { userId: auth.userId } },
        },
      }),
      loadStages(auth.tenantId, 'chat'),
    ])

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const base = page.map((row) =>
      mapConversationToListDto(
        mapRawConversationRow(row as Parameters<typeof mapRawConversationRow>[0]),
        chatStages,
      ),
    )
    // Each enrichment only adds its own fields to the same rows (same order): run them together.
    const [withAgents, withOrders, withSnooze] = await Promise.all([
      enrichConversationDtosWithAgents(auth.tenantId, base),
      enrichConversationDtosWithLinkedOrders(auth.tenantId, base),
      attachSnoozeState(auth.tenantId, base),
    ])
    const conversations = base.map((_, i) => ({
      ...withAgents[i],
      ...('linkedOrder' in withOrders[i] ? { linkedOrder: withOrders[i].linkedOrder } : {}),
      ...(withSnooze[i].snooze ? { snooze: withSnooze[i].snooze } : {}),
    }))

    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last
        ? encodeTimestampCursor(
            { timestamp: last.lastMessageAt.toISOString(), id: last.id },
            scope,
          )
        : null

    return NextResponse.json({
      success: true,
      conversations,
      nextCursor,
      maxRevision: (maxRevisionAgg._max.revision ?? BigInt(0)).toString(),
      // Phase 2b: false until migration 036 is applied (the inbox hides "Posponer").
      snoozeAvailable: conversations.length ? !workStateKnownMissing() : await probeWorkState(auth.tenantId),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    const status = /Invalid/.test(message) ? 400 : 500
    if (status === 500) console.error('[chat/conversations GET]', error)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
