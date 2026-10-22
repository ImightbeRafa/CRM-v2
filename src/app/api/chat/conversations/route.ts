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
import { attachFollowUpFlag, attachOpenOrderFlag, closedStageKeys, listFollowUpOnlyIds, listOpenOrderConversationIds, viewWhere } from '@/lib/chat-inbox-views-server'
import { searchConversationIds } from '@/lib/chat-search-server'
import { aiOnLineIds } from '@/lib/soft-ai/agent-inbox-enrich'
import { attachNeedsPersonFlag, listUnansweredIds } from '@/lib/chat-unanswered-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(request.url)
    const input = parseConversationListQuery(searchParams)
    // A quick view is one page (up to 100, no cursor): its tab count says how many there are.
    const limit = input.view
      ? parsePageLimit(searchParams.get('limit'), 50, 100)
      : parsePageLimit(searchParams.get('limit'), 30, 50)
    const scope = conversationListCursorScope(auth.tenantId, input)
    const cursor = input.view ? null : decodeTimestampCursor(searchParams.get('cursor'), scope)

    const platformAccountIds = await resolveListPlatformIds(auth.tenantId, input)
    if (input.platform && platformAccountIds && platformAccountIds.length === 0) {
      return NextResponse.json({ success: true, conversations: [], nextCursor: null, maxRevision: '0' })
    }

    // Pospuestos: only this business's chats snoozed right now (they can be far down the list).
    // Quick views: open chats only (closed = the tenant's won / lost stages).
    const viewClosedKeys = input.view ? closedStageKeys((await loadStages(auth.tenantId, 'chat')).stages) : []
    const restrictIds = input.snoozed
      ? await listSnoozedConversationIds(auth.tenantId)
      : input.view === 'seguimientos'
        ? await listFollowUpOnlyIds(auth.tenantId, viewClosedKeys, limit)
        : input.view === 'pedido'
          ? await listOpenOrderConversationIds(auth.tenantId, viewClosedKeys, limit)
          : input.view === 'sin_responder'
            ? await listUnansweredIds(
                auth.tenantId,
                viewClosedKeys,
                limit,
                input.socialAccountId ? [input.socialAccountId] : platformAccountIds,
              )
            : null
    const searchConversationIdsForQuery = input.q ? await searchConversationIds(auth.tenantId, input.q) : null
    if (restrictIds && restrictIds.length === 0) {
      return NextResponse.json({ success: true, conversations: [], nextCursor: null, maxRevision: '0', snoozeAvailable: !workStateKnownMissing() })
    }

    const listWhere = buildConversationListWhere({
      tenantId: auth.tenantId,
      input,
      viewerUserId: auth.userId,
      platformAccountIds,
      restrictIds,
      searchConversationIds: searchConversationIdsForQuery,
    })
    const aiLineIds =
      input.view === 'ia'
        ? await aiOnLineIds(
            auth.tenantId,
            (await prisma.socialAccount.findMany({ where: { tenantId: auth.tenantId }, select: { id: true } })).map((a) => a.id),
          )
        : []
    const baseWhere = input.view
      ? { AND: [listWhere, viewWhere(input.view, viewClosedKeys, aiLineIds)] }
      : listWhere

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
        // Every list and view: newest activity first (Rafael 2026-10-22). Seguimientos: newest follow-up first.
        orderBy: input.view === 'seguimientos'
          ? [{ lastOutboundAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
          : [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          ...listSelect,
          readStates: { ...listSelect.readStates, where: { userId: auth.userId } },
        },
      }),
      loadStages(auth.tenantId, 'chat'),
    ])

    const hasMore = !input.view && rows.length > limit
    const page = rows.slice(0, limit)
    const base = page.map((row) =>
      mapConversationToListDto(
        mapRawConversationRow(row as Parameters<typeof mapRawConversationRow>[0]),
        chatStages,
      ),
    )
    // Each enrichment only adds its own fields to the same rows (same order): run them together.
    const [withAgents, withOrders, withSnooze, withFollowUp, withOpen, withNeedsPerson] = await Promise.all([
      enrichConversationDtosWithAgents(auth.tenantId, base),
      enrichConversationDtosWithLinkedOrders(auth.tenantId, base),
      attachSnoozeState(auth.tenantId, base),
      attachFollowUpFlag(auth.tenantId, base),
      attachOpenOrderFlag(auth.tenantId, base),
      attachNeedsPersonFlag(auth.tenantId, base),
    ])
    const conversations = base.map((_, i) => ({
      ...withAgents[i],
      ...('linkedOrder' in withOrders[i] ? { linkedOrder: withOrders[i].linkedOrder } : {}),
      ...(withSnooze[i].snooze ? { snooze: withSnooze[i].snooze } : {}),
      ...(withFollowUp[i].lastIsFollowUp ? { lastIsFollowUp: true } : {}),
      hasOpenOrder: withOpen[i].hasOpenOrder === true,
      ...(withNeedsPerson[i].needsPerson ? { needsPerson: true } : {}),
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
    // Only our own input checks ("Invalid view", "Invalid cursor"…) are echoed; database errors stay generic.
    const status = /^Invalid [A-Za-z]+$/.test(message) ? 400 : 500
    if (status === 500) console.error('[chat/conversations GET]', error)
    return NextResponse.json({ success: false, error: status === 400 ? message : 'list_failed' }, { status })
  }
}
