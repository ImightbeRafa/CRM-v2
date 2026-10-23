/**
 * Super-admin event log for ad sales measurement (Meta Conversions API for Business Messaging): what each queued
 * Purchase event did, for every business. Read-only, ids / amounts / statuses only: no customer names, phones or
 * message text (the referral headline is the business's own ad copy).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingTable } from '@/lib/meta-attribution/referral-store'

export const EVENT_LOG_STATUSES = ['pending', 'processing', 'sent', 'failed', 'skipped', 'expired'] as const
export const EVENT_LOG_CHANNELS = ['whatsapp', 'instagram'] as const

export type EventLogFilters = {
  tenantId: string | null
  status: (typeof EVENT_LOG_STATUSES)[number] | null
  channel: (typeof EVENT_LOG_CHANNELS)[number] | null
  limit: number
}

/** Only allowlisted values pass; anything else is ignored. */
export function parseEventLogFilters(params: URLSearchParams): EventLogFilters {
  const status = params.get('status')
  const channel = params.get('channel')
  const tenantId = params.get('tenantId')
  const limit = Number(params.get('limit'))
  return {
    tenantId: tenantId && /^[a-z0-9]{8,40}$/i.test(tenantId) ? tenantId : null,
    status: (EVENT_LOG_STATUSES as readonly string[]).includes(status || '') ? (status as EventLogFilters['status']) : null,
    channel: (EVENT_LOG_CHANNELS as readonly string[]).includes(channel || '') ? (channel as EventLogFilters['channel']) : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 200,
  }
}

export type EventLogRow = {
  id: string
  tenantId: string
  tenantName: string | null
  channel: string
  status: string
  isTest: boolean
  eventName: string
  eventTime: string
  value: string | null
  currency: string | null
  orderId: string | null
  orderNumber: string | null
  conversationId: string | null
  adId: string | null
  adHeadline: string | null
  adClickedAt: string | null
  attempts: number
  createdAt: string
  sentAt: string | null
  /** Graph `fbtrace_id` of Meta's answer (Meta support trace id). */
  fbtraceId: string | null
  lastErrorCode: string | null
  lastErrorAt: string | null
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)

export async function loadMetaEventLog(filters: EventLogFilters): Promise<{ rows: EventLogRow[]; tablesMissing: boolean }> {
  let events
  try {
    events = await prisma.metaConversionEvent.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.channel ? { channel: filters.channel } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    })
  } catch (error) {
    if (isMissingTable(error)) return { rows: [], tablesMissing: true }
    throw error
  }
  const tenantIds = [...new Set(events.map((e) => e.tenantId))]
  const orderIds = [...new Set(events.map((e) => e.orderId).filter((v): v is string => Boolean(v)))]
  const referralIds = [...new Set(events.map((e) => e.referralId).filter((v): v is string => Boolean(v)))]
  const [tenants, orders, referrals] = await Promise.all([
    tenantIds.length ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [],
    orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, tenantId: true, orderId: true } }) : [],
    referralIds.length
      ? prisma.chatAdReferral
          .findMany({ where: { id: { in: referralIds } }, select: { id: true, tenantId: true, sourceId: true, headline: true, occurredAt: true } })
          .catch(() => [])
      : [],
  ])
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]))
  // Joined on (id, tenantId): a row can never show another business's order or ad.
  const orderBy = new Map(orders.map((o) => [`${o.tenantId}:${o.id}`, o.orderId]))
  const referralBy = new Map(referrals.map((r) => [`${r.tenantId}:${r.id}`, r]))
  return {
    tablesMissing: false,
    rows: events.map((e) => {
      const ref = e.referralId ? referralBy.get(`${e.tenantId}:${e.referralId}`) : undefined
      return {
        id: e.id,
        tenantId: e.tenantId,
        tenantName: tenantName.get(e.tenantId) ?? null,
        channel: e.channel,
        status: e.status,
        isTest: e.isTest,
        eventName: e.eventName,
        eventTime: new Date(e.eventTime).toISOString(),
        value: e.value === null || e.value === undefined ? null : String(e.value),
        currency: e.currency,
        orderId: e.orderId,
        orderNumber: e.orderId ? orderBy.get(`${e.tenantId}:${e.orderId}`) ?? null : null,
        conversationId: e.conversationId,
        adId: ref?.sourceId ?? null,
        adHeadline: ref?.headline ? String(ref.headline).slice(0, 120) : null,
        adClickedAt: iso(ref?.occurredAt),
        attempts: e.attempts,
        createdAt: new Date(e.createdAt).toISOString(),
        sentAt: iso(e.sentAt),
        fbtraceId: e.fbtraceId,
        lastErrorCode: e.lastErrorCode,
        lastErrorAt: iso(e.lastErrorAt),
      }
    }),
  }
}
