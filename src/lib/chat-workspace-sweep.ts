/**
 * Chat workspace sweep (Phase 2b), run every minute by /api/cron/chat-workspace. For businesses
 * that turned rules on in Config › Chats (everything is off by default):
 *
 * 1. Assignment: unassigned open chats whose customer wrote AFTER rules were enabled get a
 *    teammate (round-robin or least busy), only inside business hours, skipping snoozed chats and
 *    (by default) chats the AI is handling. Conditional write `assignedUserId: null`, so it never
 *    takes a chat from anyone and coexists with "first human who replies" (whoever writes first wins).
 * 2. Auto-close: open chats idle for N days (not snoozed, no open task) move to the chosen closed
 *    stage; conditional on the chat not having changed since it was read.
 * 3. Reopen on inbound: a closed chat (by a human or auto) whose customer wrote after it was closed
 *    goes back to "nuevo".
 *
 * Bounded: ≤ 50 assignments / 100 closes / 100 reopens per business per run, overall time budget.
 * Never touches the webhook / inbound path (guard test). Before 036: no-op.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { loadStages } from '@/lib/crm-stages-server'
import { isClosedCategory } from '@/lib/crm-stages'
import { filterChatMembers, notifyUsers } from '@/lib/workspace-notifications'
import { isWithinBusinessHours, pickByWorkload, pickRoundRobin } from '@/lib/chat-assignment-rules'
import { rowToSettings, type StoredWorkspaceSettings } from '@/lib/chat-workspace-settings'

const ASSIGN_CAP = 50
const CLOSE_CAP = 100
const REOPEN_CAP = 100

export type SweepSummary = { tenants: number; assigned: number; closed: number; reopened: number; skipped?: string }

async function stageKeys(tenantId: string) {
  const { stages } = await loadStages(tenantId, 'chat')
  const closed = stages.filter((s) => isClosedCategory(s.category)).map((s) => s.key)
  const closedSet = new Set(closed)
  // 'hecho' is closed even if a business renamed / archived it (legacy default).
  closedSet.add('hecho')
  return { closed: [...closedSet], activeClosed: new Set(stages.filter((s) => isClosedCategory(s.category) && !s.archived).map((s) => s.key)) }
}

async function snoozedIds(tenantId: string, now: Date): Promise<Set<string>> {
  const rows = await prisma.chatConversationWorkState.findMany({
    where: { tenantId, snoozedUntil: { gt: now } },
    select: { conversationId: true },
    take: 5000,
  })
  return new Set(rows.map((r) => r.conversationId))
}

async function assignForTenant(tenantId: string, s: StoredWorkspaceSettings, closed: string[], now: Date): Promise<number> {
  if (s.assignmentMode === 'off' || !s.assignmentEnabledAt) return 0
  if (!isWithinBusinessHours(s.businessHours, s.timezone, now)) return 0
  // Re-check members every run: someone deactivated stops receiving chats immediately.
  const candidates = await filterChatMembers(tenantId, s.assigneeUserIds)
  if (!candidates.length) return 0
  const chats = await prisma.chatConversation.findMany({
    where: {
      tenantId,
      assignedUserId: null,
      status: { notIn: closed },
      lastInboundAt: { gte: s.assignmentEnabledAt },
      ...(s.skipAiActive ? { NOT: { aiMode: 'ai_active' } } : {}),
    },
    orderBy: { lastInboundAt: 'asc' },
    select: { id: true },
    take: ASSIGN_CAP * 2,
  })
  if (!chats.length) return 0
  const snoozed = await snoozedIds(tenantId, now)
  const todo = chats.filter((c) => !snoozed.has(c.id)).slice(0, ASSIGN_CAP)
  if (!todo.length) return 0

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
  for (const chat of todo) {
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
  if (s.assignmentMode === 'round_robin' && cursor !== s.rrCursorUserId) {
    await prisma.chatWorkspaceSettings.updateMany({ where: { tenantId }, data: { rrCursorUserId: cursor } })
  }
  return assigned
}

async function autoCloseForTenant(tenantId: string, s: StoredWorkspaceSettings, closed: string[], activeClosed: Set<string>, now: Date): Promise<number> {
  if (!s.autoCloseDays || !s.autoCloseStageKey || !activeClosed.has(s.autoCloseStageKey)) return 0
  const cutoff = new Date(now.getTime() - s.autoCloseDays * 24 * 60 * 60 * 1000)
  const idle = await prisma.chatConversation.findMany({
    where: { tenantId, status: { notIn: closed }, lastMessageAt: { lt: cutoff } },
    orderBy: { lastMessageAt: 'asc' },
    select: { id: true, status: true },
    take: CLOSE_CAP,
  })
  if (!idle.length) return 0
  const [snoozed, withTasks] = await Promise.all([
    snoozedIds(tenantId, now),
    prisma.crmTask.findMany({
      where: { tenantId, status: 'open', conversationId: { in: idle.map((c) => c.id) } },
      select: { conversationId: true },
    }),
  ])
  const busy = new Set(withTasks.map((t) => t.conversationId))
  let closedCount = 0
  for (const chat of idle) {
    if (snoozed.has(chat.id) || busy.has(chat.id)) continue
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
  const data = by ? { closedAt: now, closedBy: by, updatedAt: now } : { closedAt: null, closedBy: null, updatedAt: now }
  try {
    const res = await prisma.chatConversationWorkState.updateMany({ where: { conversationId, tenantId }, data })
    if (res.count === 0 && by) {
      await prisma.chatConversationWorkState.create({ data: { conversationId, tenantId, ...data } }).catch((error: { code?: string }) => {
        if (error?.code !== 'P2002') throw error
      })
    }
  } catch (error) {
    if (!isMissingRelation(error)) console.warn('[workspace] closedAt not stored', error instanceof Error ? error.message : error)
  }
}

async function reopenForTenant(tenantId: string, s: StoredWorkspaceSettings, closed: string[], now: Date): Promise<number> {
  if (!s.reopenOnInbound) return 0
  const states = await prisma.chatConversationWorkState.findMany({
    where: { tenantId, closedAt: { not: null } },
    select: { conversationId: true, closedAt: true },
    orderBy: { closedAt: 'desc' },
    take: 2000,
  })
  if (!states.length) return 0
  const closedAt = new Map(states.map((w) => [w.conversationId, w.closedAt!]))
  const convs = await prisma.chatConversation.findMany({
    where: { tenantId, id: { in: [...closedAt.keys()] }, status: { in: closed }, lastInboundAt: { not: null } },
    select: { id: true, status: true, lastInboundAt: true },
  })
  let reopened = 0
  for (const c of convs) {
    if (reopened >= REOPEN_CAP) break
    const at = closedAt.get(c.id)
    if (!at || !c.lastInboundAt || c.lastInboundAt.getTime() <= at.getTime()) continue
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
  const now = opts.now ?? new Date()
  const started = Date.now()
  const budget = opts.budgetMs ?? 40_000
  const summary: SweepSummary = { tenants: 0, assigned: 0, closed: 0, reopened: 0 }
  let rows
  try {
    rows = await prisma.chatWorkspaceSettings.findMany({
      where: { OR: [{ assignmentMode: { not: 'off' } }, { autoCloseDays: { not: null } }, { reopenOnInbound: true }] },
      take: 500,
    })
  } catch (error) {
    if (isMissingRelation(error)) return { ...summary, skipped: 'tables_missing' }
    throw error
  }
  for (const row of rows) {
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
