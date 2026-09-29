import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { isSnoozedNow, type SnoozeDto } from '@/lib/chat-work-state'

let tableMissingUntil = 0
const MISSING_TTL_MS = 5 * 60_000

export function workStateKnownMissing(): boolean {
  return Date.now() < tableMissingUntil
}

function markMissing(error: unknown): boolean {
  if (!isMissingRelation(error)) return false
  tableMissingUntil = Date.now() + MISSING_TTL_MS
  return true
}

/**
 * Adds `snooze` to list / changes DTOs (one indexed query per page). Never breaks the list:
 * before 036, or on any error, DTOs come back unchanged.
 */
export async function attachSnoozeState<T extends { id: string; lastInboundAt?: string | null; snooze?: SnoozeDto }>(
  tenantId: string,
  dtos: T[],
): Promise<T[]> {
  if (!dtos.length || workStateKnownMissing()) return dtos
  try {
    const rows = await prisma.chatConversationWorkState.findMany({
      where: { tenantId, conversationId: { in: dtos.map((d) => d.id) }, snoozedUntil: { not: null } },
      select: { conversationId: true, snoozedUntil: true, snoozedAt: true },
    })
    if (!rows.length) return dtos
    const byId = new Map(rows.map((r) => [r.conversationId, r]))
    const now = new Date()
    return dtos.map((d) => {
      const ws = byId.get(d.id)
      if (!ws) return d
      const inbound = d.lastInboundAt ? new Date(d.lastInboundAt) : null
      return isSnoozedNow(ws, inbound, now)
        ? { ...d, snooze: { until: ws.snoozedUntil!.toISOString(), at: ws.snoozedAt!.toISOString() } }
        : d
    })
  } catch (error) {
    if (!markMissing(error)) console.warn('[snooze] list skipped', error instanceof Error ? error.message : error)
    return dtos
  }
}

/** Touch the conversation so its revision bumps (trigger 024) and every open inbox refreshes it. */
async function bumpConversation(tenantId: string, conversationId: string) {
  await prisma.chatConversation.updateMany({ where: { id: conversationId, tenantId }, data: { updatedAt: new Date() } })
}

export async function setSnooze(args: {
  tenantId: string
  conversationId: string
  userId: string
  until: Date | null
}): Promise<{ ok: true; snooze: SnoozeDto } | { ok: false; status: number; error: string }> {
  if (workStateKnownMissing()) return { ok: false, status: 503, error: 'Posponer aún no está disponible.' }
  const conv = await prisma.chatConversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    select: { id: true },
  })
  if (!conv) return { ok: false, status: 404, error: 'Chat no encontrado' }
  const now = new Date()
  const data = args.until
    ? { snoozedUntil: args.until, snoozedAt: now, snoozedByUserId: args.userId, updatedAt: now }
    : { snoozedUntil: null, snoozedAt: null, snoozedByUserId: null, updatedAt: now }
  try {
    // Tenant-scoped write: update this business's row, else create it (PK = conversationId).
    const updated = await prisma.chatConversationWorkState.updateMany({ where: { conversationId: conv.id, tenantId: args.tenantId }, data })
    if (updated.count === 0 && args.until) {
      try {
        await prisma.chatConversationWorkState.create({ data: { conversationId: conv.id, tenantId: args.tenantId, ...data } })
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2002') throw error
        await prisma.chatConversationWorkState.updateMany({ where: { conversationId: conv.id, tenantId: args.tenantId }, data })
      }
    }
    await bumpConversation(args.tenantId, conv.id)
  } catch (error) {
    if (markMissing(error)) return { ok: false, status: 503, error: 'Posponer aún no está disponible.' }
    throw error
  }
  void recordActivity({
    tenantId: args.tenantId,
    actorUserId: args.userId,
    verb: args.until ? 'chat.snooze' : 'chat.unsnooze',
    entityType: 'ChatConversation',
    entityId: conv.id,
    conversationId: conv.id,
    surface: 'chats',
    ...(args.until ? { props: { minutes: Math.round((args.until.getTime() - now.getTime()) / 60_000) } } : {}),
  })
  return { ok: true, snooze: args.until ? { until: args.until.toISOString(), at: now.toISOString() } : null }
}
