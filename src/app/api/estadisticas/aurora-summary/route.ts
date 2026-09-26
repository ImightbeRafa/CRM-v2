import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { readTenantUiReadiness } from '@/lib/feature-flags'
import { buildStatsDateRange, buildStatsOrderDateWhere, getOrderStatsDateKey } from '@/lib/statistics-dates'
import { auroraPeriodRange, auroraPreviousRange, resolveAuroraPeriod, safeAmount } from '@/lib/statistics-aurora'
import { isCollectedRevenue } from '@/lib/order-payment-status'
import { channelIdentity } from '@/lib/agent-channel-bind'

// Read-only, tenant-scoped. Same auth + `statistics` readiness as the other estadisticas APIs.
export const dynamic = 'force-dynamic'

const cache = new Map<string, { at: number; data: unknown }>()
const TTL = 30_000
const MAX_CACHE = 100
const ORDER_TAKE = 25_001

type OrderRow = {
  total: number | null
  saleDate: string | null
  timestamp: Date
  status: string | null
  contraEntrega: boolean
  cePaymentConfirmed: boolean
  customFields: unknown
}

/** Missing table (Prisma P2021 / Postgres 42P01) → optional metric is unavailable, not an error. */
function isMissingTable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2021'
  return String((error as { code?: unknown })?.code || '') === '42P01'
}

type ChatGroup = { socialAccountId: string; _count: { _all: number } }

async function optional<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
}

function summarize(orders: OrderRow[], collectedMode: boolean) {
  let revenue = 0
  const days = new Map<string, { revenue: number; orderCount: number }>()
  for (const order of orders) {
    const total = safeAmount(order.total)
    const counted = collectedMode ? (isCollectedRevenue(order) ? total : 0) : total
    revenue += counted
    const key = getOrderStatsDateKey(order)
    if (!key) continue
    const day = days.get(key) ?? { revenue: 0, orderCount: 0 }
    day.revenue += counted
    day.orderCount += 1
    days.set(key, day)
  }
  return { revenue, orders: orders.length, days }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_statistics')
    if (!auth.ok) return auth.response
    const tenantId = auth.tenantId

    const period = resolveAuroraPeriod(request.nextUrl.searchParams.get('period'))
    if (!period) return NextResponse.json({ error: 'Invalid period' }, { status: 400 })

    const readiness = await readTenantUiReadiness(tenantId)
    const collectedMode = readiness.statistics.enabled && readiness.statistics.mode === 'primary'
    const revenueMode = collectedMode ? 'collected' : 'booked'

    const range = auroraPeriodRange(period)
    const prevRange = auroraPreviousRange(range)
    const key = `${tenantId}:${period}:${revenueMode}:${range.endDate}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data)

    const prisma = getTenantPrisma(tenantId)
    const chatWindow = buildStatsDateRange(range.startDate, range.endDate)
    const orderSelect = {
      total: true,
      saleDate: true,
      timestamp: true,
      status: true,
      contraEntrega: true,
      cePaymentConfirmed: true,
      customFields: true,
    } as const

    const [currentOrders, previousOrders] = await Promise.all([
      prisma.order.findMany({
        where: { tenantId, ...buildStatsOrderDateWhere(range.startDate, range.endDate) },
        select: orderSelect,
        take: ORDER_TAKE,
      }),
      prisma.order.findMany({
        where: { tenantId, ...buildStatsOrderDateWhere(prevRange.startDate, prevRange.endDate) },
        select: orderSelect,
        take: ORDER_TAKE,
      }),
    ])
    if (currentOrders.length > 25_000 || previousOrders.length > 25_000) {
      return NextResponse.json({ error: 'Elegí un período más corto' }, { status: 413 })
    }

    const [chatGroups, accounts, aiTurns] = await Promise.all([
      optional<ChatGroup[]>(() =>
        (prisma.chatConversation as any).groupBy({
          by: ['socialAccountId'],
          where: { tenantId, createdAt: { gte: chatWindow.start ?? undefined, lte: chatWindow.end ?? undefined } },
          _count: { _all: true },
        }),
      ),
      optional(() =>
        prisma.socialAccount.findMany({
          where: { tenantId, platform: { in: ['whatsapp', 'instagram'] } },
          select: {
            id: true,
            platform: true,
            isActive: true,
            displayName: true,
            displayPhoneNumber: true,
            providerUsername: true,
          },
          orderBy: { linkedAt: 'asc' },
        }),
      ),
      optional<unknown[]>(() =>
        (prisma.chatAgentTurn as any).groupBy({
          by: ['conversationId'],
          where: {
            tenantId,
            status: 'delivered',
            testSessionId: null,
            conversationId: { not: null },
            createdAt: { gte: chatWindow.start ?? undefined, lte: chatWindow.end ?? undefined },
          },
        }),
      ),
    ])

    const cur = summarize(currentOrders as OrderRow[], collectedMode)
    const prev = summarize(previousOrders as OrderRow[], collectedMode)

    const chatCounts = new Map((chatGroups ?? []).map((g) => [g.socialAccountId, g._count._all]))
    const lines =
      accounts === null
        ? null
        : accounts.map((account) => {
            const identity = channelIdentity({
              id: account.id,
              platform: account.platform,
              displayName: account.displayName,
              displayPhoneNumber: account.displayPhoneNumber,
              providerUsername: account.providerUsername,
              attendedByThisAgent: false,
            })
            return {
              socialAccountId: account.id,
              platform: account.platform,
              title: identity.title,
              detail: identity.detail,
              isActive: account.isActive,
              chats: chatCounts.get(account.id) ?? 0,
            }
          })

    const chatsOpened = chatGroups === null ? null : [...chatCounts.values()].reduce((a, b) => a + b, 0)

    const data = {
      period,
      range,
      previous: prevRange,
      revenueMode,
      kpis: {
        revenue: { current: cur.revenue, previous: prev.revenue },
        orders: { current: cur.orders, previous: prev.orders },
      },
      daily: [...cur.days.entries()].map(([date, d]) => ({ date, revenue: d.revenue, orderCount: d.orderCount })),
      dailyPrevious: [...prev.days.entries()].map(([date, d]) => ({ date, revenue: d.revenue, orderCount: d.orderCount })),
      lines,
      funnel: {
        chatsOpened,
        aiResponded: aiTurns === null ? null : aiTurns.length,
        ordersCreated: cur.orders,
      },
      // ChatMessage.orderId exists but no chat UI writes it yet: chat→pedido is not derivable.
      chatOrderLink: { available: false as const },
    }

    cache.set(key, { at: Date.now(), data })
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching aurora statistics summary:', error)
    return NextResponse.json({ error: 'Failed to fetch statistics summary' }, { status: 500 })
  }
}
