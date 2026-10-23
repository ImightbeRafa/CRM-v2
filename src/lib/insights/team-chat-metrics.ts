/**
 * "Know what sells" (Lane E2) · chat metrics for the team. Pure (no DB).
 *
 * - First response: ActivityEvent `chat.first_response` (ms from the customer's first message to the
 *   team's first human reply; recorded since 2026-09-30, src/lib/chat-send-metrics.ts).
 * - Waiting ("sin responder"): open chat whose newest message is the customer's (lastInboundAt after
 *   lastOutboundAt). A reply by the AI also counts as answered.
 * - Load: open chats assigned to each teammate now + human replies they sent in the period.
 * - Chat → sale: linked orders in the period / chats created in the period, per channel.
 */

import { median, percentile, rate } from '@/lib/insights/stats-math'

export type ChatChannel = 'whatsapp' | 'instagram'
export const CHAT_CHANNELS: readonly ChatChannel[] = ['whatsapp', 'instagram']

export type FirstResponseSample = { userId: string | null; channel: ChatChannel; ms: number; /** CR day key, for the trend. */ day?: string }

export type FirstResponseDay = { date: string; medianMs: number | null; samples: number }

export type OpenChatRow = {
  channel: ChatChannel
  assignedUserId: string | null
  lastInboundAt: Date | null
  lastOutboundAt: Date | null
}

export type ChannelMetrics = {
  channel: ChatChannel
  firstResponseMedianMs: number | null
  firstResponseP90Ms: number | null
  firstResponseSamples: number
  open: number
  waiting: number
  oldestWaitingMs: number | null
  chatsStarted: number
  linkedOrders: number
  chatToSale: number | null
}

export type TeammateMetrics = {
  userId: string
  firstResponseMedianMs: number | null
  firstResponseP90Ms: number | null
  firstResponseSamples: number
  openAssigned: number
  waitingAssigned: number
  replies: number
}

export type TeamChatReport = {
  channels: ChannelMetrics[]
  teammates: TeammateMetrics[]
  overall: { firstResponseMedianMs: number | null; firstResponseP90Ms: number | null; samples: number; waiting: number; waitingUnassigned: number; open: number }
  /** Median first response per day of the period (null = nobody measured that day). */
  daily: FirstResponseDay[]
}

/** The customer wrote last and nobody (team or AI) answered after that. */
export function isWaiting(chat: Pick<OpenChatRow, 'lastInboundAt' | 'lastOutboundAt'>): boolean {
  if (!chat.lastInboundAt) return false
  if (!chat.lastOutboundAt) return true
  return chat.lastInboundAt.getTime() > chat.lastOutboundAt.getTime()
}

export function buildTeamChatReport(input: {
  firstResponses: readonly FirstResponseSample[]
  openChats: readonly OpenChatRow[]
  repliesByUser: ReadonlyMap<string, number>
  chatsStartedByChannel: ReadonlyMap<ChatChannel, number>
  linkedOrdersByChannel: ReadonlyMap<ChatChannel, number>
  /** Teammates to list even with no activity (active chat members). */
  teamUserIds?: readonly string[]
  /** Every day of the period (CR date keys) for the daily trend. */
  dayKeys?: readonly string[]
  now?: Date
}): TeamChatReport {
  const now = (input.now ?? new Date()).getTime()
  const valid = input.firstResponses.filter((s) => Number.isFinite(s.ms) && s.ms >= 0)

  const channels: ChannelMetrics[] = CHAT_CHANNELS.map((channel) => {
    const samples = valid.filter((s) => s.channel === channel).map((s) => s.ms)
    const open = input.openChats.filter((c) => c.channel === channel)
    const waiting = open.filter(isWaiting)
    const oldest = waiting.reduce<number | null>((max, c) => {
      const age = now - (c.lastInboundAt as Date).getTime()
      return max === null || age > max ? age : max
    }, null)
    const chatsStarted = input.chatsStartedByChannel.get(channel) ?? 0
    const linkedOrders = input.linkedOrdersByChannel.get(channel) ?? 0
    return {
      channel,
      firstResponseMedianMs: median(samples),
      firstResponseP90Ms: percentile(samples, 0.9),
      firstResponseSamples: samples.length,
      open: open.length,
      waiting: waiting.length,
      oldestWaitingMs: oldest !== null && oldest >= 0 ? oldest : null,
      chatsStarted,
      linkedOrders,
      chatToSale: rate(linkedOrders, chatsStarted),
    }
  })

  const userIds = new Set<string>(input.teamUserIds ?? [])
  for (const s of valid) if (s.userId) userIds.add(s.userId)
  for (const c of input.openChats) if (c.assignedUserId) userIds.add(c.assignedUserId)
  for (const id of input.repliesByUser.keys()) userIds.add(id)

  const teammates: TeammateMetrics[] = [...userIds].map((userId) => {
    const samples = valid.filter((s) => s.userId === userId).map((s) => s.ms)
    const assigned = input.openChats.filter((c) => c.assignedUserId === userId)
    return {
      userId,
      firstResponseMedianMs: median(samples),
      firstResponseP90Ms: percentile(samples, 0.9),
      firstResponseSamples: samples.length,
      openAssigned: assigned.length,
      waitingAssigned: assigned.filter(isWaiting).length,
      replies: input.repliesByUser.get(userId) ?? 0,
    }
  })
  teammates.sort((a, b) => b.replies - a.replies || b.openAssigned - a.openAssigned || a.userId.localeCompare(b.userId))

  const daily: FirstResponseDay[] = (input.dayKeys ?? []).map((date) => {
    const day = valid.filter((s) => s.day === date).map((s) => s.ms)
    return { date, medianMs: median(day), samples: day.length }
  })
  const all = valid.map((s) => s.ms)
  const waitingAll = input.openChats.filter(isWaiting)
  return {
    channels,
    teammates,
    overall: {
      firstResponseMedianMs: median(all),
      firstResponseP90Ms: percentile(all, 0.9),
      samples: all.length,
      waiting: waitingAll.length,
      waitingUnassigned: waitingAll.filter((c) => !c.assignedUserId).length,
      open: input.openChats.length,
    },
    daily,
  }
}

/** ActivityEvent.props → ms, only a sane non-negative number (props is JSON written by our code). */
export function readFirstResponseMs(props: unknown): number | null {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null
  const ms = (props as { ms?: unknown }).ms
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null
}
