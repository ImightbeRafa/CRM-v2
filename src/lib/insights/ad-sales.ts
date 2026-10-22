/**
 * "Know what sells" (Lane E2) · ad → chat → sale attribution. Pure (no DB): the server loader
 * hands in tenant-scoped rows, this file decides which ad gets each chat and each order.
 *
 * Rules (plain words, also shown in the UI):
 * - A chat counts for an ad when the customer arrived from that ad inside the period
 *   (ChatAdReferral.occurredAt in range). A chat that came from two ads counts for both
 *   (the distinct total is shown apart).
 * - "Sin anuncio": chats created in the period that never came from an ad (before the period ends).
 * - An order belongs to the LAST ad the customer came from before the order was created
 *   (last touch), within the attribution window (7 days, same as Meta and our CAPI sweep:
 *   meta-attribution/payment.ts ATTRIBUTION_WINDOW_DAYS). No ad touch in the window → "Sin anuncio".
 * - Only orders linked to a chat (ChatMessage.orderId, latest linking message) can be attributed;
 *   the rest are shown as "Pedido sin chat" so the totals match the main Estadísticas page.
 */

import { money, rate } from '@/lib/insights/stats-math'

export type AdPlatform = 'whatsapp' | 'instagram'
export const ORGANIC_KEY = 'organic'
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 7

export type AdTouchRow = {
  conversationId: string
  platform: AdPlatform
  sourceId: string | null
  sourceUrl: string | null
  headline: string | null
  occurredAt: Date
}

export type AdChatRow = {
  id: string
  platform: AdPlatform
  createdAt: Date
}

export type AdOrderRow = {
  /** Order.id (db id). */
  id: string
  conversationId: string
  platform: AdPlatform
  /** Order.timestamp (when the order was created). */
  createdAt: Date
  total: number | null
  /** isCollectedRevenue(order) — paid (or contra-entrega confirmed). */
  collected: boolean
  cancelled: boolean
}

export type AdSalesRow = {
  key: string
  adId: string | null
  headline: string | null
  sourceUrl: string | null
  campaignName: string | null
  platforms: AdPlatform[]
  chats: number
  orders: number
  paidOrders: number
  booked: number
  collected: number
  /** orders / chats of the period, null without chats. */
  conversion: number | null
}

export type UnlinkedOrderTotals = { orders: number; paidOrders: number; booked: number; collected: number }

export type AdSalesReport = {
  rows: AdSalesRow[]
  organic: AdSalesRow
  /** Orders of the period that are not linked to any chat (only without a channel filter). */
  withoutChat: UnlinkedOrderTotals
  windowDays: number
  totals: {
    /** Distinct chats that came from any ad (a chat from two ads counts once here). */
    adChatsDistinct: number
    organicChats: number
    orders: number
    adOrders: number
    booked: number
    collected: number
  }
}

const NO_ORDERS: UnlinkedOrderTotals = { orders: 0, paidOrders: 0, booked: 0, collected: 0 }

/** Stable key for an ad: Meta ad id, else its link, else its headline (some referrals carry no id). */
export function adKey(touch: Pick<AdTouchRow, 'sourceId' | 'sourceUrl' | 'headline'>): string {
  const id = touch.sourceId?.trim()
  if (id) return `ad:${id}`
  const url = touch.sourceUrl?.trim()
  if (url) return `url:${url}`
  const headline = touch.headline?.trim()
  if (headline) return `headline:${headline.toLowerCase()}`
  return 'ad:unknown'
}

/**
 * The last touch at or before `at` and not older than `windowDays` (ties → the later row in input order).
 * Null when none.
 */
export function lastTouchBefore<T extends { occurredAt: Date }>(
  touches: readonly T[],
  at: Date,
  windowDays = DEFAULT_ATTRIBUTION_WINDOW_DAYS,
): T | null {
  const oldest = at.getTime() - windowDays * 86_400_000
  let best: T | null = null
  for (const t of touches) {
    const time = t.occurredAt.getTime()
    if (time > at.getTime() || time < oldest) continue
    if (!best || time >= best.occurredAt.getTime()) best = t
  }
  return best
}

function emptyRow(key: string, touch: AdTouchRow | null): AdSalesRow {
  return {
    key,
    adId: touch?.sourceId ?? null,
    headline: touch?.headline ?? null,
    sourceUrl: touch?.sourceUrl ?? null,
    campaignName: null,
    platforms: [],
    chats: 0,
    orders: 0,
    paidOrders: 0,
    booked: 0,
    collected: 0,
    conversion: null,
  }
}

function addPlatform(row: AdSalesRow, platform: AdPlatform): void {
  if (!row.platforms.includes(platform)) row.platforms.push(platform)
}

/**
 * @param touches every ad touch of the chats involved (any date: last touch needs history before the period)
 * @param chats   chats created in the period (for "sin anuncio")
 * @param orders  orders in the period that are linked to a chat (cancelled ones are skipped)
 * @param withoutChat totals of the period's orders with no linked chat
 * @param range   the period as instants [start, end]
 * @param platform optional channel filter
 */
export function buildAdSalesReport(input: {
  touches: readonly AdTouchRow[]
  chats: readonly AdChatRow[]
  orders: readonly AdOrderRow[]
  withoutChat?: UnlinkedOrderTotals
  range: { start: Date; end: Date }
  platform?: AdPlatform | null
  windowDays?: number
}): AdSalesReport {
  const { range } = input
  const windowDays = input.windowDays ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS
  const platformOk = (p: AdPlatform) => !input.platform || p === input.platform
  const inRange = (d: Date) => d.getTime() >= range.start.getTime() && d.getTime() <= range.end.getTime()

  const touchesByChat = new Map<string, AdTouchRow[]>()
  for (const t of input.touches) {
    if (!platformOk(t.platform)) continue
    const list = touchesByChat.get(t.conversationId) ?? []
    list.push(t)
    touchesByChat.set(t.conversationId, list)
  }

  const rows = new Map<string, AdSalesRow>()
  const rowFor = (touch: AdTouchRow): AdSalesRow => {
    const key = adKey(touch)
    let row = rows.get(key)
    if (!row) {
      row = emptyRow(key, touch)
      rows.set(key, row)
    }
    // Keep the newest wording / link we saw for this ad.
    if (touch.headline) row.headline = touch.headline
    if (touch.sourceUrl) row.sourceUrl = touch.sourceUrl
    return row
  }
  const organic = emptyRow(ORGANIC_KEY, null)

  // Chats per ad: distinct chats with a touch from that ad inside the period.
  const counted = new Set<string>()
  const adChats = new Set<string>()
  for (const [conversationId, list] of touchesByChat) {
    for (const t of list) {
      if (!inRange(t.occurredAt)) continue
      adChats.add(conversationId)
      const row = rowFor(t)
      addPlatform(row, t.platform)
      const mark = `${row.key}|${conversationId}`
      if (counted.has(mark)) continue
      counted.add(mark)
      row.chats += 1
    }
  }

  // "Sin anuncio": chats created in the period with no ad touch up to the end of the period.
  for (const chat of input.chats) {
    if (!platformOk(chat.platform) || !inRange(chat.createdAt)) continue
    const list = touchesByChat.get(chat.id) ?? []
    if (list.some((t) => t.occurredAt.getTime() <= range.end.getTime())) continue
    organic.chats += 1
    addPlatform(organic, chat.platform)
  }

  // Orders: last touch before the order was created, inside the window.
  const seenOrders = new Set<string>()
  for (const order of input.orders) {
    if (order.cancelled || !platformOk(order.platform) || seenOrders.has(order.id)) continue
    seenOrders.add(order.id)
    const touch = lastTouchBefore(touchesByChat.get(order.conversationId) ?? [], order.createdAt, windowDays)
    const row = touch ? rowFor(touch) : organic
    addPlatform(row, order.platform)
    const total = money(order.total)
    row.orders += 1
    row.booked += total
    if (order.collected) {
      row.paidOrders += 1
      row.collected += total
    }
  }

  const list = [...rows.values()]
  for (const row of [...list, organic]) row.conversion = rate(row.orders, row.chats)
  list.sort((a, b) => b.booked - a.booked || b.orders - a.orders || b.chats - a.chats || a.key.localeCompare(b.key))

  // Orders without a chat have no channel: only part of the unfiltered view.
  const withoutChat = input.platform ? NO_ORDERS : (input.withoutChat ?? NO_ORDERS)
  const adOrders = list.reduce((s, r) => s + r.orders, 0)
  return {
    rows: list,
    organic,
    withoutChat,
    windowDays,
    totals: {
      adChatsDistinct: adChats.size,
      organicChats: organic.chats,
      orders: adOrders + organic.orders + withoutChat.orders,
      adOrders,
      booked: list.reduce((s, r) => s + r.booked, 0) + organic.booked + withoutChat.booked,
      collected: list.reduce((s, r) => s + r.collected, 0) + organic.collected + withoutChat.collected,
    },
  }
}

/** Fills campaign names from the adapter (null = not available yet, e.g. before Meta `ads_read`). */
export function withCampaignNames(report: AdSalesReport, names: ReadonlyMap<string, string>): AdSalesReport {
  if (names.size === 0) return report
  return {
    ...report,
    rows: report.rows.map((row) => (row.adId && names.has(row.adId) ? { ...row, campaignName: names.get(row.adId) ?? null } : row)),
  }
}

/** Only http(s) links are shown as a link (a referral URL is customer-side data from Meta). */
export function safeAdLink(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}
