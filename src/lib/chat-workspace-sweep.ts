/**
 * Chat workspace sweep (Phase 2b), run every minute by /api/cron/chat-workspace.
 *
 * 0. Wake: snoozes whose time passed are cleared and the chat is touched (revision bump), so every
 *    open inbox gets it back through the changes feed — for every business (no setting needed).
 * For businesses that turned rules on in Config › Chats (everything is off by default):
 * 1. Assignment: unassigned open chats whose customer wrote AFTER rules were enabled get a
 *    teammate (round-robin or least busy), only inside business hours, skipping snoozed chats and
 *    (by default) chats the AI is handling. Conditional write `assignedUserId: null`, so it never
 *    takes a chat from anyone and coexists with "first human who replies" (whoever writes first wins).
 * 2. Auto-close: open chats idle for N days (not snoozed, no open task) move to the chosen closed
 *    stage; conditional on the chat not having changed since it was read.
 * 3. Reopen on inbound: a closed chat whose customer wrote after it was closed AND after reopen was
 *    turned on goes back to "nuevo" (never the backlog).
 *
 * Bounded: ≤ 50 assignments / 100 closes / 100 reopens per business per run, overall time budget.
 * Never touches the webhook / inbound path (guard test). Before 036: no-op (memoized).
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { loadStages } from '@/lib/crm-stages-server'
import { isClosedCategory } from '@/lib/crm-stages'
import { isSnoozedNow } from '@/lib/chat-work-state'
import { filterChatMembers, notifyUsers } from '@/lib/workspace-notifications'
import { isWithinBusinessHours, pickByWorkload, pickRoundRobin } from '@/lib/chat-assignment-rules'
import { rowToSettings, type StoredWorkspaceSettings } from '@/lib/chat-workspace-settings'

const ASSIGN_CAP = 50
const CLOSE_CAP = 100
const REOPEN_CAP = 100
const WAKE_CAP = 500

let tablesMissingUntil = 0
/** One sweep at a time per process (the Worker routes crons to the primary container; INFRA-13). */
let running = false

export type SweepSummary = { tenants: number; assigned: number; closed: number; reopened: number; woken: number; skipped?: string }

/**
 * "Not handled by the AI": aiMode is NULL for most chats, and SQL `NOT (aiMode = 'ai_active')` is
 * NULL for them — Prisma's `not` would silently drop every such chat (Verifier M1).
 */
export const NOT_AI_ACTIVE: Prisma.ChatConversationWhereInput = { OR: [{ aiMode: null }, { aiMode: { not: 'ai_active' } }] }

async function stageKeys(tenantId: string) {
  const { stages } = await loadStages(tenantId, 'chat')
  const closedSet = new Set(stages.filter((s) => isClosedCategory(s.category)).map((s) => s.key))
  // 'hecho' is closed even if a business renamed / archived it (legacy default).
  closedSet.add('hecho')
  return { closed: [...closedSet], activeClosed: new Set(stages.filter((s) => isClosedCategory(s.category) && !s.archived).map((s) => s.key)) }
}

/**
 * Snoozed right now, same rule as the inbox (Verifier S3): time not reached AND the customer has
 * not written since it was snoozed.
 */
async function snoozedIds(tenantId: string, now: Date): Promise<Set<string>> {
  const rows = await prisma.chatConversationWorkState.findMany({
    where: { tenantId, snoozedUntil: { gt: now } },
    select: { conversationId: true, snoozedUntil: true, snoozedAt: true },
    take: 5000,
  })
  if (!rows.length) return new Set()
  const convs = await prisma.chatConversation.findMany({
    where: { tenantId, id: { in: rows.map((r) => r.conversationId) } },
    select: { id: true, lastInboundAt: true },
  })
  const inbound = new Map(convs.map((c) => [c.id, c.lastInboundAt]))
  return new Set(rows.filter((r) => isSnoozedNow(r, inbound.get(r.conversationId) ?? null, now)).map((r) => r.conversationId))
}

/** Step 0 (all businesses): clear expired snoozes and touch the chat so every inbox refreshes it. */
async function wakeExpiredSnoozes(now: Date): Promise<number> {
  const due = await prisma.chatConversationWorkState.findMany({
    where: { snoozedUntil: { lte: now } },
    select: { conversationId: true, tenantId: true },
    take: WAKE_CAP,
  })
  let woken = 0
  for (const d of due) {
    const res = await prisma.chatConversationWorkState.updateMany({
      where: { conversationId: d.conversationId, tenantId: d.tenantId, snoozedUntil: { lte: now } },
      data: { snoozedUntil: null, snoozedAt: null, snoozedByUserId: null, updatedAt: now },
    })
    if (!res.count) continue
    await prisma.chatConversation.updateMany({ where: { id: d.conversationId, tenantId: d.tenantId }, data: { updatedAt: now } })
    woken++
  }
  return woken
}

async function assignForTenant(tenantId: string, s: StoredWorkspaceSettings, closed: string[], now: Date): Promise<number> {
  if (s.assignmentMode === 'off' || !s.assignmentEnabledAt) return 0
  if (!isWithinBusinessHours(s.businessHours, s.timezone, now)) return 0
  // Re-check members every run: someone deactivated stops receiving chats immediately.
  const candidates = await filterChatMembers(tenantId, s.assigneeUserIds)
  if (!candidates.length) return 0
  const snoozed = await snoozedIds(tenantId, now)
  const chats = await prisma.chatConversation.findMany({
    where: {
      tenantId,
      assignedUserId: null,
      status: { notIn: closed },
      lastInboundAt: { gte: s.assignmentEnabledAt },
      // Snoozed chats are excluded in the query, so they can never starve the queue (S2).
      ...(snoozed.size ? { id: { notIn: [...snoozed] } } : {}),
      ...(s.skipAiActive ? NOT_AI_ACTIVE : {}),
    },
    orderBy: { lastInboundAt: 'asc' },
    select: { id: true },
    take: ASSIGN_CAP,
  })
  if (!chats.length) return 0

  const loads = new Map<string, number>()
  if (s.assignmentMode === 'workload') {
    const grouped = await prisma.chatConversation.groupBy({
      by: ['assignedUserId'],
      where: { tenantId, assignedUserId: { in: candidates }, status: { notIn: closed } },
      _count: { _all: true },
    })
    for (const g of grouped) if (g.assignedUserId) loads.set(g.assignedUserId, g._count._all)
  }

  let cursor = s.rrCursorUserId
  let assigned = 0
  try {
    for (const chat of chats) {
      const pick = s.assignmentMode === 'workload' ? pickByWorkload(candidates, loads) : pickRoundRobin(candidates, cursor)
      if (!pick) break
      const res = await prisma.chatConversation.updateMany({
        where: { id: chat.id, tenantId, assignedUserId: null },
        data: { assignedUserId: pick },
      })
      if (res.count === 0) continue // someone replied first: they keep it
      assigned++
      cursor = pick
      loads.set(pick, (loads.get(pick) ?? 0) + 1)
      void recordActivity({
        tenantId,
        actorUserId: null,
        actorKind: 'system',
        verb: 'chat.auto_assign',
        entityType: 'ChatConversation',
        entityId: chat.id,
        conversationId: chat.id,
        props: { to: pick, mode: s.assignmentMode },
      })
      void notifyUsers({
        tenantId,
        actorUserId: null,
        kind: 'chat_assigned',
        userIds: [pick],
        dedupeKey: (u) => `chat_assigned:${chat.id}:${u}`,
        conversationId: chat.id,
      })
    }
  } finally {
    // Saved even if a write above failed midway, so the turn order stays fair (N6).
    if (s.assignmentMode === 'round_robin' && cursor !== s.rrCursorUserId) {
      await prisma.chatWorkspaceSettings.updateMany({ where: { tenantId }, data: { rrCursorUserId: cursor } })
    }
  }
  return assigned
}

async function autoCloseForTenant(tenantId: string, s: StoredWorkspaceSettings, closed: string[], activeClosed: Set<string>, now: Date): Promise<number> {
  if (!s.autoCloseDays || !s.autoCloseStageKey || !activeClosed.has(s.autoCloseStageKey)) return 0
  const cutoff = new Date(now.getTime() - s.autoCloseDays * 24 * 60 * 60 * 1000)
  const [snoozed, withTasks] = await Promise.all([
    snoozedIds(tenantId, now),
    prisma.crmTask.findMany({
      where: { tenantId, status: 'open', conversationId: { not: null } },
      select: { conversationId: true },
      distinct: ['conversationId'],
      take: 5000,
    }),
  ])
  // Exempt chats are excluded in the query (not skipped afterwards), so they never block the rest (S2).
  const exempt = new Set<string>([...snoozed, ...withTasks.map((t) => t.conversationId!).filter(Boolean)])
  const idle = await prisma.chatConversation.findMany({
    where: {
      tenantId,
      status: { notIn: closed },
      lastMessageAt: { lt: cutoff },
      ...(exempt.size ? { id: { notIn: [...exempt] } } : {}),
    },
    orderBy: { lastMessageAt: 'asc' },
    select: { id: true, status: true },
    take: CLOSE_CAP,
  })
  let closedCount = 0
  for (const chat of idle) {
    // Conditional: still the same stage and still idle (a new message moves lastMessageAt).
    const res = await prisma.chatConversation.updateMany({
      where: { id: chat.id, tenantId, status: chat.status, lastMessageAt: { lt: cutoff } },
      data: { status: s.autoCloseStageKey },
    })
    if (res.count === 0) continue
    closedCount++
    await markClosed(tenantId, chat.id, 'auto', now)
    void recordActivity({
      tenantId,
      actorUserId: null,
      actorKind: 'system',
      verb: 'chat.auto_close',
      entityType: 'ChatConversation',
      entityId: chat.id,
      conversationId: chat.id,
      props: { from: chat.status, to: s.autoCloseStageKey, days: s.autoCloseDays },
    })
  }
  return closedCount
}

/** Closed-at bookkeeping (used by the sweep and by the conversation PATCH). Tenant-scoped. */
export async function markClosed(tenantId: string, conversationId: string, by: 'human' | 'auto' | null, now = new Date()): Promise<void> {
  if (Date.now() < tablesMissingUntil) return
  const data = by ? { closedAt: now, closedBy: by, updatedAt: now } : { closedAt: null, closedBy: null, updatedAt: now }
  try {
    const res = await prisma.chatConversationWorkState.updateMany({ where: { conversationId, tenantId }, data })
    if (res.count === 0 && by) {
      await prisma.chatConversationWorkState.create({ data: { conversationId, tenantId, ...data } }).catch((error: { code?: string }) => {
        if (error?.code !== 'P2002') throw error
      })
    }
  } catch (error) {
    if (isMissingRelation(error)) tablesMissingUntil = Date.now() + 5 * 60_000
    else console.warn('[workspace] closedAt not stored', error instanceof Error ? error.message : error)
  }
}

/**
 * Reopen, driven from the chat side (S1): closed chats whose customer wrote after reopen was turned
 * on; each is reopened only if that message is newer than when it was closed.
 */
async function reopenForTenant(tenantId: string, s: StoredWorkspaceSettings, closed: string[], now: Date): Promise<number> {
  if (!s.reopenOnInbound || !s.reopenEnabledAt) return 0
  const convs = await prisma.chatConversation.findMany({
    where: { tenantId, status: { in: closed }, lastInboundAt: { gte: s.reopenEnabledAt } },
    orderBy: { lastInboundAt: 'desc' },
    select: { id: true, status: true, lastInboundAt: true },
    take: REOPEN_CAP * 3,
  })
  if (!convs.length) return 0
  const states = await prisma.chatConversationWorkState.findMany({
    where: { tenantId, conversationId: { in: convs.map((c) => c.id) } },
    select: { conversationId: true, closedAt: true },
  })
  const closedAt = new Map(states.map((w) => [w.conversationId, w.closedAt]))
  let reopened = 0
  for (const c of convs) {
    if (reopened >= REOPEN_CAP) break
    const at = closedAt.get(c.id)
    // No closedAt: closed before this feature and the customer wrote after reopen was enabled → reopen.
    if (at && c.lastInboundAt && c.lastInboundAt.getTime() <= at.getTime()) continue
    const res = await prisma.chatConversation.updateMany({
      where: { id: c.id, tenantId, status: c.status },
      data: { status: 'nuevo' },
    })
    if (res.count === 0) continue
    reopened++
    await markClosed(tenantId, c.id, null, now)
    void recordActivity({
      tenantId,
      actorUserId: null,
      actorKind: 'system',
      verb: 'chat.reopen',
      entityType: 'ChatConversation',
      entityId: c.id,
      conversationId: c.id,
      props: { from: c.status },
    })
  }
  return reopened
}

export async function runChatWorkspaceSweep(opts: { now?: Date; budgetMs?: number } = {}): Promise<SweepSummary> {
  const summary: SweepSummary = { tenants: 0, assigned: 0, closed: 0, reopened: 0, woken: 0 }
  if (running) return { ...summary, skipped: 'already_running' }
  running = true
  try {
    return await sweepOnce(opts, summary)
  } finally {
    running = false
  }
}

async function sweepOnce(opts: { now?: Date; budgetMs?: number }, summary: SweepSummary): Promise<SweepSummary> {
  const now = opts.now ?? new Date()
  const started = Date.now()
  const budget = opts.budgetMs ?? 40_000
  if (Date.now() < tablesMissingUntil) return { ...summary, skipped: 'tables_missing' }
  let rows
  try {
    summary.woken = await wakeExpiredSnoozes(now)
    rows = await prisma.chatWorkspaceSettings.findMany({
      where: { OR: [{ assignmentMode: { not: 'off' } }, { autoCloseDays: { not: null } }, { reopenOnInbound: true }] },
      orderBy: { tenantId: 'asc' },
      take: 500,
    })
  } catch (error) {
    if (isMissingRelation(error)) {
      tablesMissingUntil = Date.now() + 5 * 60_000
      return { ...summary, skipped: 'tables_missing' }
    }
    throw error
  }
  // Rotate the starting business every minute so a slow one never starves the rest.
  const offset = rows.length ? Math.floor(now.getTime() / 60_000) % rows.length : 0
  const ordered = [...rows.slice(offset), ...rows.slice(0, offset)]
  for (const row of ordered) {
    if (Date.now() - started > budget) {
      summary.skipped = 'time_budget'
      break
    }
    const s = rowToSettings(row)
    try {
      const { closed, activeClosed } = await stageKeys(row.tenantId)
      summary.reopened += await reopenForTenant(row.tenantId, s, closed, now)
      summary.assigned += await assignForTenant(row.tenantId, s, closed, now)
      summary.closed += await autoCloseForTenant(row.tenantId, s, closed, activeClosed, now)
      summary.tenants++
    } catch (error) {
      // One business failing never blocks the others.
      console.error('[chat-workspace-sweep] tenant failed', error instanceof Error ? error.message : error)
    }
  }
  return summary
}
