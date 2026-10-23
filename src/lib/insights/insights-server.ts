/**
 * "Know what sells" (Lane E2) · server loaders for the ad → sale report, the team chat metrics and the
 * agent performance dashboard. Read-only.
 *
 * Tenant isolation: every query takes the session tenantId. Raw SQL skips the getTenantPrisma extension,
 * so EVERY table in every raw query carries its own `"tenantId" = ${tenantId}` (checked by
 * src/lib/__tests__/insights-tenant-sql.test.ts). Raw reads go through queryWithTimeout (8 s, 2 slots).
 * Tables created by raw SQL (ChatAdReferral 039, ActivityEvent 035) are optional: missing → empty.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { addDaysToStatsDateKey, buildStatsDateRange, formatStatsDateKey } from '@/lib/statistics-dates'
import { isCancelledFulfillment, isCollectedRevenue } from '@/lib/order-payment-status'
import { isMissingTable } from '@/lib/meta-attribution/referral-store'
import { queryWithTimeout } from '@/lib/soft-ai/safe-query'
import { readOutcomeMarkers } from '@/lib/soft-ai/agent-turn-outcome'
import { loadAgentNames } from '@/lib/soft-ai/agent-usage-server'
import { loadStages } from '@/lib/crm-stages-server'
import { closedStageKeys } from '@/lib/chat-inbox-views-server'
import { hasPermission, type Role } from '@/lib/rbac'
import {
  buildAdSalesReport,
  withCampaignNames,
  type AdPlatform,
  type AdSalesReport,
  type AdTouchRow,
  type UnlinkedOrderTotals,
} from '@/lib/insights/ad-sales'
import { loadCampaignNames } from '@/lib/insights/ad-campaign-adapter'
import {
  buildTeamChatReport,
  readFirstResponseMs,
  type ChatChannel,
  type FirstResponseSample,
  type TeamChatReport,
} from '@/lib/insights/team-chat-metrics'
import {
  buildAgentPerformance,
  SALE_WINDOW_DAYS,
  type AgentOrderFact,
  type AgentPerformance,
  type AgentTurnFact,
} from '@/lib/insights/agent-performance'
import { money } from '@/lib/insights/stats-math'

export const ORDER_CAP = 25_000
const ROW_CAP = 50_000
const DAY_MS = 86_400_000

/** Too much data for one period: the route answers 413 "elegí un período más corto". */
export class InsightsTooLargeError extends Error {
  constructor() {
    super('INSIGHTS_TOO_LARGE')
    this.name = 'InsightsTooLargeError'
  }
}

export type DateKeyRange = { startDate: string; endDate: string }

function instants(range: DateKeyRange): { start: Date; end: Date } {
  const r = buildStatsDateRange(range.startDate, range.endDate)
  if (!r.start || !r.end) throw new Error('Invalid range')
  return { start: r.start, end: r.end }
}

function channelOf(platform: string | null | undefined): ChatChannel | null {
  return platform === 'whatsapp' || platform === 'instagram' ? platform : null
}

async function optionalRows<T>(run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run()
  } catch (error) {
    if (isMissingTable(error)) return []
    throw error
  }
}

// ── Orders of the period + their chat ────────────────────────────────────────────────────────────

export type PeriodOrder = {
  id: string
  timestamp: Date
  total: number
  collected: boolean
  cancelled: boolean
  /** Latest linking message's chat (same rule as the CAPI sweep). */
  conversationId: string | null
  channel: ChatChannel | null
}

type OrderRow = {
  id: string
  timestamp: Date
  total: number | null
  status: string | null
  contraEntrega: boolean
  cePaymentConfirmed: boolean
  customFields: unknown
}

/**
 * The SQL twin of buildStatsOrderDateWhere (what /api/estadisticas/aurora-summary uses): an ISO sale date
 * in the instant range, a date-only sale date in the CR day keys, else the creation time. Archived orders
 * out. Raw so it runs in the analytics slot with the 8 s statement timeout (parity checked on real data).
 */
export function periodOrdersSql(tenantId: string, range: DateKeyRange, limit: number): Prisma.Sql {
  const r = buildStatsDateRange(range.startDate, range.endDate)
  if (!r.start || !r.end || !r.startKey || !r.endKey) throw new Error('Invalid range')
  const startIso = r.start.toISOString()
  const endIso = r.end.toISOString()
  const endKeyMax = `${r.endKey}￿`
  return Prisma.sql`
    SELECT o."id", o."timestamp", o."total", o."status", o."contraEntrega", o."cePaymentConfirmed", o."customFields"
      FROM public."Order" o
     WHERE o."tenantId" = ${tenantId}
       AND o."deletedAt" IS NULL
       AND (
         (o."saleDate" IS NOT NULL AND o."saleDate" LIKE '%T%' AND o."saleDate" >= ${startIso} AND o."saleDate" <= ${endIso})
         OR (o."saleDate" IS NOT NULL AND o."saleDate" <> '' AND o."saleDate" NOT LIKE '%T%'
             AND o."saleDate" >= ${r.startKey} AND o."saleDate" <= ${endKeyMax})
         OR ((o."saleDate" IS NULL OR o."saleDate" = '') AND o."timestamp" >= ${r.start} AND o."timestamp" <= ${r.end})
       )
     LIMIT ${limit}`
}

/** Same orders as /api/estadisticas/aurora-summary (sale date in the CR period, archived excluded). */
export async function loadPeriodOrders(tenantId: string, range: DateKeyRange): Promise<PeriodOrder[]> {
  const orders = await queryWithTimeout<OrderRow[]>(periodOrdersSql(tenantId, range, ORDER_CAP + 1))
  if (orders.length > ORDER_CAP) throw new InsightsTooLargeError()
  const links = orders.length
    ? await queryWithTimeout<Array<{ orderId: string; conversationId: string; platform: string }>>(Prisma.sql`
        SELECT DISTINCT ON (cm."orderId") cm."orderId", cm."conversationId", s."platform"
          FROM public."ChatMessage" cm
          JOIN public."ChatConversation" c ON c."id" = cm."conversationId" AND c."tenantId" = ${tenantId}
          JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
         WHERE cm."tenantId" = ${tenantId}
           AND cm."orderId" = ANY(${orders.map((o) => o.id)}::text[])
           AND cm."conversationId" IS NOT NULL
         ORDER BY cm."orderId", cm."sentAt" DESC`)
    : []
  const byOrder = new Map(links.map((l) => [l.orderId, l]))
  return orders.map((o) => {
    const link = byOrder.get(o.id)
    return {
      id: o.id,
      timestamp: o.timestamp,
      total: money(o.total),
      collected: isCollectedRevenue(o),
      cancelled: isCancelledFulfillment(o.status),
      conversationId: link?.conversationId ?? null,
      channel: channelOf(link?.platform),
    }
  })
}

// ── 1. Ad → chat → sale ──────────────────────────────────────────────────────────────────────────

export async function loadAdSalesReport(input: {
  tenantId: string
  range: DateKeyRange
  platform: AdPlatform | null
}): Promise<AdSalesReport> {
  const { tenantId } = input
  const { start, end } = instants(input.range)
  const touchFrom = new Date(start.getTime() - SALE_WINDOW_DAYS * DAY_MS)

  const [orders, touches, chats] = await Promise.all([
    loadPeriodOrders(tenantId, input.range),
    optionalRows(() =>
      queryWithTimeout<Array<AdTouchRow & { platform: string }>>(Prisma.sql`
        SELECT r."conversationId", r."platform", r."sourceId", r."sourceUrl", r."headline", r."occurredAt"
          FROM public."ChatAdReferral" r
         WHERE r."tenantId" = ${tenantId}
           AND r."occurredAt" >= ${touchFrom} AND r."occurredAt" <= ${end}
           -- Real ads only, same rule as the CAPI sweep (meta-attribution/sweep.ts): organic posts and
           -- ig.me ?ref= links are referrals too, but not ads.
           AND (
             (r."platform" = 'whatsapp' AND r."ctwaClid" IS NOT NULL)
             OR (r."platform" = 'instagram' AND r."sourceType" = 'ad' AND r."sourceId" IS NOT NULL)
           )
         LIMIT ${ROW_CAP + 1}`),
    ),
    queryWithTimeout<Array<{ id: string; platform: string; createdAt: Date }>>(Prisma.sql`
      SELECT c."id", s."platform", c."createdAt"
        FROM public."ChatConversation" c
        JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
       WHERE c."tenantId" = ${tenantId}
         AND c."createdAt" >= ${start} AND c."createdAt" <= ${end}
       LIMIT ${ROW_CAP + 1}`),
  ])
  if (touches.length > ROW_CAP || chats.length > ROW_CAP) throw new InsightsTooLargeError()

  const withoutChat: UnlinkedOrderTotals = { orders: 0, paidOrders: 0, booked: 0, collected: 0 }
  const cancelled: UnlinkedOrderTotals = { orders: 0, paidOrders: 0, booked: 0, collected: 0 }
  const linked = []
  for (const o of orders) {
    if (o.cancelled) {
      // Counted like the Resumen does (orders + booked), never attributed to an ad.
      cancelled.orders += 1
      cancelled.booked += o.total
      if (o.collected) {
        cancelled.paidOrders += 1
        cancelled.collected += o.total
      }
      continue
    }
    if (o.conversationId && o.channel) {
      linked.push({ id: o.id, conversationId: o.conversationId, platform: o.channel, createdAt: o.timestamp, total: o.total, collected: o.collected, cancelled: false })
    } else {
      withoutChat.orders += 1
      withoutChat.booked += o.total
      if (o.collected) {
        withoutChat.paidOrders += 1
        withoutChat.collected += o.total
      }
    }
  }

  const report = buildAdSalesReport({
    touches: touches.flatMap((t) => {
      const platform = channelOf(t.platform)
      return platform ? [{ ...t, platform }] : []
    }),
    chats: chats.flatMap((c) => {
      const platform = channelOf(c.platform)
      return platform ? [{ id: c.id, platform, createdAt: c.createdAt }] : []
    }),
    orders: linked,
    withoutChat,
    cancelled,
    range: { start, end },
    platform: input.platform,
  })
  const adIds = report.rows.map((r) => r.adId).filter((id): id is string => Boolean(id))
  return withCampaignNames(report, await loadCampaignNames(tenantId, adIds))
}

/** Every CR day key of the range (capped like the periods themselves). */
export function dayKeysOf(range: DateKeyRange): string[] {
  const keys: string[] = []
  for (let k = range.startDate; k <= range.endDate && keys.length < 400; k = addDaysToStatsDateKey(k, 1)) keys.push(k)
  return keys
}

// ── 3. Team chat metrics ─────────────────────────────────────────────────────────────────────────

/** Open chats with movement in this window count for the backlog (very old never-closed chats are noise). */
export const BACKLOG_ACTIVE_DAYS = 30

export type TeamMember = { userId: string; name: string }

/** Active members of THIS business who can work chats; names only (never emails). */
export async function loadChatTeam(tenantId: string): Promise<TeamMember[]> {
  const rows = await prisma.membership.findMany({
    where: { tenantId, isActive: true, user: { active: true } },
    select: { userId: true, role: true, user: { select: { name: true } } },
    take: 200,
  })
  return rows
    .filter((r) => hasPermission(r.role as Role, 'update_sales'))
    .map((r) => ({ userId: r.userId, name: r.user?.name?.trim() || 'Sin nombre' }))
}

export async function loadTeamChatReport(input: {
  tenantId: string
  range: DateKeyRange
  now?: Date
}): Promise<{ report: TeamChatReport; team: TeamMember[] }> {
  const { tenantId } = input
  const now = input.now ?? new Date()
  const { start, end } = instants(input.range)
  const activeSince = new Date(now.getTime() - BACKLOG_ACTIVE_DAYS * DAY_MS)

  const { stages } = await loadStages(tenantId, 'chat')
  const closed = closedStageKeys(stages)

  const [firstResponses, openChats, replies, started, orders, team] = await Promise.all([
    optionalRows(() =>
      queryWithTimeout<Array<{ actorUserId: string | null; props: unknown; platform: string | null; occurredAt: Date }>>(Prisma.sql`
        SELECT e."actorUserId", e."props", s."platform", e."occurredAt"
          FROM public."ActivityEvent" e
          LEFT JOIN public."ChatConversation" c ON c."id" = e."conversationId" AND c."tenantId" = ${tenantId}
          LEFT JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
         WHERE e."tenantId" = ${tenantId}
           AND e."verb" = 'chat.first_response'
           AND e."occurredAt" >= ${start} AND e."occurredAt" <= ${end}
         LIMIT ${ROW_CAP}`),
    ),
    queryWithTimeout<Array<{ platform: string; assignedUserId: string | null; lastInboundAt: Date | null; lastOutboundAt: Date | null }>>(Prisma.sql`
      SELECT s."platform", c."assignedUserId", c."lastInboundAt", c."lastOutboundAt"
        FROM public."ChatConversation" c
        JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
       WHERE c."tenantId" = ${tenantId}
         AND NOT (c."status" = ANY(${closed}::text[]))
         AND c."lastMessageAt" >= ${activeSince}
       LIMIT ${ROW_CAP}`),
    // Who sent it: the promoted column when set, else metadata.senderUserId (what the send routes write
    // today — on real data the column is empty while metadata has the sender).
    queryWithTimeout<Array<{ senderUserId: string; replies: number }>>(Prisma.sql`
      SELECT COALESCE(m."senderUserId", m."metadata" ->> 'senderUserId') AS "senderUserId", count(*)::int AS "replies"
        FROM public."ChatMessage" m
       WHERE m."tenantId" = ${tenantId}
         AND m."direction" = 'outbound'
         AND COALESCE(m."senderUserId", m."metadata" ->> 'senderUserId') IS NOT NULL
         AND m."sentAt" >= ${start} AND m."sentAt" <= ${end}
       GROUP BY 1`),
    queryWithTimeout<Array<{ platform: string; chats: number }>>(Prisma.sql`
      SELECT s."platform", count(*)::int AS "chats"
        FROM public."ChatConversation" c
        JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
       WHERE c."tenantId" = ${tenantId}
         AND c."createdAt" >= ${start} AND c."createdAt" <= ${end}
       GROUP BY 1`),
    loadPeriodOrders(tenantId, input.range),
    loadChatTeam(tenantId),
  ])

  const samples: FirstResponseSample[] = []
  for (const row of firstResponses) {
    const ms = readFirstResponseMs(row.props)
    const channel = channelOf(row.platform)
    if (ms === null || !channel) continue
    samples.push({ userId: row.actorUserId, channel, ms, day: formatStatsDateKey(row.occurredAt) })
  }
  const teamIds = new Set(team.map((m) => m.userId))
  const linkedByChannel = new Map<ChatChannel, number>()
  for (const o of orders) {
    if (o.cancelled || !o.channel) continue
    linkedByChannel.set(o.channel, (linkedByChannel.get(o.channel) ?? 0) + 1)
  }
  const report = buildTeamChatReport({
    // Only people of this business are listed (a removed member's samples still count per channel).
    firstResponses: samples.map((s) => (s.userId && teamIds.has(s.userId) ? s : { ...s, userId: null })),
    openChats: openChats.flatMap((c) => {
      const channel = channelOf(c.platform)
      return channel
        ? [{ channel, assignedUserId: c.assignedUserId && teamIds.has(c.assignedUserId) ? c.assignedUserId : null, lastInboundAt: c.lastInboundAt, lastOutboundAt: c.lastOutboundAt }]
        : []
    }),
    repliesByUser: new Map(replies.filter((r) => teamIds.has(r.senderUserId)).map((r) => [r.senderUserId, Number(r.replies)])),
    chatsStartedByChannel: new Map(started.flatMap((r) => (channelOf(r.platform) ? [[channelOf(r.platform) as ChatChannel, Number(r.chats)] as const] : []))),
    linkedOrdersByChannel: linkedByChannel,
    teamUserIds: [...teamIds],
    dayKeys: dayKeysOf(input.range),
    now,
  })
  return { report, team }
}

// ── 2. Agent performance ─────────────────────────────────────────────────────────────────────────

type TurnRow = {
  id: string
  agentId: string
  conversationId: string | null
  status: string
  errorCode: string | null
  costMicros: bigint | number | null
  createdAt: Date
  completedAt: Date | null
  triggerAt: Date | null
  markers: unknown
}

export type AgentPerformanceRow = AgentPerformance & { name: string; status: string | null }

export async function loadAgentPerformance(input: {
  tenantId: string
  range: DateKeyRange
}): Promise<AgentPerformanceRow[]> {
  const { tenantId } = input
  const { start, end } = instants(input.range)
  const historyFrom = new Date(start.getTime() - SALE_WINDOW_DAYS * DAY_MS)

  const [turnRows, sends, orders] = await Promise.all([
    // Live turns only (tests and Probar excluded); the hand-off markers only, never the whole trace.
    queryWithTimeout<TurnRow[]>(Prisma.sql`
      SELECT t."id", t."agentId", t."conversationId", t."status", t."errorCode",
             t."estimatedCostMicros" AS "costMicros", t."createdAt", t."completedAt",
             tm."sentAt" AS "triggerAt",
             t."decisionTrace" -> 'outcomeMarkers' AS "markers"
        FROM public."ChatAgentTurn" t
        LEFT JOIN public."ChatMessage" tm ON tm."id" = t."triggerMessageId" AND tm."tenantId" = ${tenantId}
       WHERE t."tenantId" = ${tenantId}
         AND t."createdAt" >= ${historyFrom} AND t."createdAt" <= ${end}
         AND t."mode" <> 'test'
         AND t."testSessionId" IS NULL
       LIMIT ${ROW_CAP + 1}`),
    // When each reply actually reached the chat (first message of the turn).
    queryWithTimeout<Array<{ turnId: string; sentAt: Date }>>(Prisma.sql`
      SELECT m."metadata" ->> 'turnId' AS "turnId", min(m."sentAt") AS "sentAt"
        FROM public."ChatMessage" m
       WHERE m."tenantId" = ${tenantId}
         AND m."direction" = 'outbound'
         AND m."sentAt" >= ${historyFrom} AND m."sentAt" <= ${new Date(end.getTime() + DAY_MS)}
         AND m."metadata" ->> 'turnId' IS NOT NULL
       GROUP BY 1
       LIMIT ${ROW_CAP + 1}`),
    loadPeriodOrders(tenantId, input.range),
  ])
  if (turnRows.length > ROW_CAP || sends.length > ROW_CAP) throw new InsightsTooLargeError()

  const sentAt = new Map(sends.map((s) => [s.turnId, s.sentAt]))
  const toFact = (row: TurnRow): AgentTurnFact => {
    const markers = readOutcomeMarkers({ outcomeMarkers: row.markers })
    return {
      agentId: row.agentId,
      conversationId: row.conversationId,
      status: row.status,
      errorCode: row.errorCode,
      costMicros: Number(row.costMicros ?? 0),
      triggerAt: row.triggerAt,
      doneAt: sentAt.get(row.id) ?? row.completedAt ?? row.createdAt,
      handoffKind: markers?.handoffKind ?? null,
      handoffReason: markers?.handoffReason ?? null,
    }
  }
  const turns: AgentTurnFact[] = []
  const historyTurns: AgentTurnFact[] = []
  for (const row of turnRows) (row.createdAt.getTime() >= start.getTime() ? turns : historyTurns).push(toFact(row))

  // Previous linked order of the same chat, so a repeat order does not credit the old conversation.
  const linked = orders.filter((o) => o.conversationId && !o.cancelled)
  const chatIds = [...new Set(linked.map((o) => o.conversationId as string))]
  const chatOrders = chatIds.length
    ? await queryWithTimeout<Array<{ conversationId: string; orderId: string; timestamp: Date }>>(Prisma.sql`
        SELECT DISTINCT cm."conversationId", o."id" AS "orderId", o."timestamp"
          FROM public."ChatMessage" cm
          JOIN public."Order" o ON o."id" = cm."orderId" AND o."tenantId" = ${tenantId}
         WHERE cm."tenantId" = ${tenantId}
           AND cm."conversationId" = ANY(${chatIds}::text[])
           AND o."deletedAt" IS NULL
         LIMIT ${ROW_CAP}`)
    : []
  const timesByChat = new Map<string, number[]>()
  for (const r of chatOrders) {
    const list = timesByChat.get(r.conversationId) ?? []
    list.push(r.timestamp.getTime())
    timesByChat.set(r.conversationId, list)
  }
  const facts: AgentOrderFact[] = linked.map((o) => {
    const before = (timesByChat.get(o.conversationId as string) ?? []).filter((t) => t < o.timestamp.getTime())
    return {
      orderId: o.id,
      conversationId: o.conversationId as string,
      createdAt: o.timestamp,
      total: o.total,
      collected: o.collected,
      cancelled: o.cancelled,
      previousOrderAt: before.length ? new Date(Math.max(...before)) : null,
    }
  })

  const perf = buildAgentPerformance({ turns, historyTurns, orders: facts })
  const names = await loadAgentNames(perf.map((p) => p.agentId), tenantId)
  // Only this business's agents (loadAgentNames is tenant-scoped): anything else is dropped.
  return perf
    .filter((p) => names[p.agentId])
    .map((p) => ({ ...p, name: names[p.agentId].name, status: names[p.agentId].status ?? null }))
}
