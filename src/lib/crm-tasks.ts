/**
 * Tasks, reminders and follow-ups (Phase 2b, migration 036 table CrmTask) on a chat and/or its
 * client. Assigned to a teammate who can work chats; due time optional.
 *
 * - Tenant-scoped everywhere; chat / client references are checked against the business.
 * - The assignee must be an active chat member of the business (same rule as chat assignment).
 * - Assigning to someone else creates a `task_assigned` notification (bell).
 * - Delete = cancel (kept for the activity history). Overdue open tasks are surfaced when read
 *   (sorted first, counted in the bell); no cron.
 * - Tolerates 036 not being applied (memoized "table missing": `available: false`).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { staffDisplayName } from '@/lib/display-name'
import { filterChatMembers, notifyUsers } from '@/lib/workspace-notifications'

export type TaskKind = 'task' | 'reminder' | 'follow_up'
export type TaskStatus = 'open' | 'done' | 'canceled'
export const TASK_TITLE_MAX = 200

let tableMissingUntil = 0
function markMissing(error: unknown): boolean {
  if (!isMissingRelation(error)) return false
  tableMissingUntil = Date.now() + 5 * 60_000
  return true
}
export function tasksKnownMissing(): boolean {
  return Date.now() < tableMissingUntil
}

export function parseTaskKind(v: unknown): TaskKind | null {
  return v === 'task' || v === 'reminder' || v === 'follow_up' ? v : null
}

export function normalizeTaskTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t && t.length <= TASK_TITLE_MAX ? t : null
}

/** Due time: optional; a valid date between one year back and two years ahead. */
export function parseDueAt(v: unknown, now: Date = new Date()): Date | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || v.length > 40) return 'invalid'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'invalid'
  const year = 365 * 24 * 60 * 60 * 1000
  if (d.getTime() < now.getTime() - year || d.getTime() > now.getTime() + 2 * year) return 'invalid'
  return d
}

/** Open tasks first (overdue first, then by due time, undated last), then done, newest first. */
export function sortTasks<T extends { status: string; dueAt: Date | null; createdAt: Date }>(rows: T[], now: Date = new Date()): T[] {
  const rank = (t: T) => (t.status !== 'open' ? 3 : t.dueAt && t.dueAt.getTime() < now.getTime() ? 0 : t.dueAt ? 1 : 2)
  return [...rows].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r) return r
    if (a.status === 'open' && a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime()
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

export type TaskDto = {
  id: string
  kind: TaskKind
  title: string
  status: TaskStatus
  dueAt: string | null
  overdue: boolean
  conversationId: string | null
  clientId: string | null
  assignee: { id: string; name: string } | null
  createdBy: { id: string; name: string } | null
  createdAt: string
  completedAt: string | null
  /** Chat / client name for "Mis tareas". */
  context: string | null
}

const taskSelect = {
  id: true,
  kind: true,
  title: true,
  status: true,
  dueAt: true,
  conversationId: true,
  clientId: true,
  assigneeUserId: true,
  createdByUserId: true,
  createdAt: true,
  completedAt: true,
} as const

type TaskRow = {
  id: string
  kind: string
  title: string
  status: string
  dueAt: Date | null
  conversationId: string | null
  clientId: string | null
  assigneeUserId: string | null
  createdByUserId: string | null
  createdAt: Date
  completedAt: Date | null
}

async function toDtos(tenantId: string, rows: TaskRow[], now = new Date()): Promise<TaskDto[]> {
  const userIds = [...new Set(rows.flatMap((r) => [r.assigneeUserId, r.createdByUserId]).filter((x): x is string => Boolean(x)))]
  const convIds = [...new Set(rows.map((r) => r.conversationId).filter((x): x is string => Boolean(x)))]
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)))]
  const [users, convs, clients] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, username: true } }) : [],
    convIds.length ? prisma.chatConversation.findMany({ where: { tenantId, id: { in: convIds } }, select: { id: true, peerName: true } }) : [],
    clientIds.length ? prisma.client.findMany({ where: { tenantId, id: { in: clientIds } }, select: { id: true, name: true } }) : [],
  ])
  const name = new Map(users.map((u) => [u.id, staffDisplayName(u.name, u.username) || 'Equipo']))
  const peer = new Map(convs.map((c) => [c.id, c.peerName]))
  const client = new Map(clients.map((c) => [c.id, c.name]))
  return rows.map((r) => ({
    id: r.id,
    kind: (parseTaskKind(r.kind) ?? 'task') as TaskKind,
    title: r.title,
    status: r.status as TaskStatus,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    overdue: r.status === 'open' && Boolean(r.dueAt && r.dueAt.getTime() < now.getTime()),
    conversationId: r.conversationId,
    clientId: r.clientId,
    assignee: r.assigneeUserId ? { id: r.assigneeUserId, name: name.get(r.assigneeUserId) || 'Equipo' } : null,
    createdBy: r.createdByUserId ? { id: r.createdByUserId, name: name.get(r.createdByUserId) || 'Equipo' } : null,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    context: (r.clientId && client.get(r.clientId)) || (r.conversationId && peer.get(r.conversationId)) || null,
  }))
}

export type TaskListResult = { available: boolean; tasks: TaskDto[] }

/** Tasks of a chat (and its client), or all tasks assigned to a user ("Mis tareas"). */
export async function listTasks(args: {
  tenantId: string
  conversationId?: string | null
  clientId?: string | null
  assigneeUserId?: string | null
  includeDone?: boolean
}): Promise<TaskListResult> {
  if (tasksKnownMissing()) return { available: false, tasks: [] }
  const or: Array<Record<string, string>> = []
  if (args.conversationId) or.push({ conversationId: args.conversationId })
  if (args.clientId) or.push({ clientId: args.clientId })
  if (!or.length && !args.assigneeUserId) return { available: true, tasks: [] }
  try {
    const rows = await prisma.crmTask.findMany({
      where: {
        tenantId: args.tenantId,
        status: args.includeDone ? { in: ['open', 'done'] } : 'open',
        ...(args.assigneeUserId ? { assigneeUserId: args.assigneeUserId } : {}),
        ...(or.length ? { OR: or } : {}),
      },
      select: taskSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return { available: true, tasks: await toDtos(args.tenantId, sortTasks(rows)) }
  } catch (error) {
    if (markMissing(error)) return { available: false, tasks: [] }
    throw error
  }
}

/** Open tasks assigned to me that are past due (bell count). */
export async function countOverdueForUser(tenantId: string, userId: string): Promise<number> {
  if (tasksKnownMissing()) return 0
  try {
    return await prisma.crmTask.count({ where: { tenantId, assigneeUserId: userId, status: 'open', dueAt: { lt: new Date() } } })
  } catch (error) {
    if (markMissing(error)) return 0
    throw error
  }
}

export type TaskResult = { ok: true; task: TaskDto } | { ok: false; status: number; error: string }

async function checkAssignee(tenantId: string, raw: unknown): Promise<string | null | 'invalid'> {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string') return 'invalid'
  const ok = await filterChatMembers(tenantId, [raw])
  return ok.length ? raw : 'invalid'
}

export async function createTask(args: {
  tenantId: string
  userId: string
  title: unknown
  kind?: unknown
  dueAt?: unknown
  assigneeUserId?: unknown
  conversationId?: string | null
  clientId?: string | null
}): Promise<TaskResult> {
  if (tasksKnownMissing()) return { ok: false, status: 503, error: 'Las tareas aún no están disponibles.' }
  const title = normalizeTaskTitle(args.title)
  if (!title) return { ok: false, status: 400, error: `La tarea necesita un título (máx. ${TASK_TITLE_MAX} caracteres).` }
  const kind = args.kind === undefined ? 'task' : parseTaskKind(args.kind)
  if (!kind) return { ok: false, status: 400, error: 'Tipo de tarea inválido' }
  const dueAt = parseDueAt(args.dueAt)
  if (dueAt === 'invalid') return { ok: false, status: 400, error: 'Fecha inválida' }
  // Default assignee: whoever creates it.
  const assignee = args.assigneeUserId === undefined ? args.userId : await checkAssignee(args.tenantId, args.assigneeUserId)
  if (assignee === 'invalid') return { ok: false, status: 400, error: 'Esa persona no puede recibir tareas de chats.' }
  if (args.conversationId) {
    const c = await prisma.chatConversation.findFirst({ where: { id: args.conversationId, tenantId: args.tenantId }, select: { id: true } })
    if (!c) return { ok: false, status: 404, error: 'Chat no encontrado' }
  }
  if (args.clientId) {
    const c = await prisma.client.findFirst({ where: { id: args.clientId, tenantId: args.tenantId }, select: { id: true } })
    if (!c) return { ok: false, status: 404, error: 'Cliente no encontrado' }
  }
  if (!args.conversationId && !args.clientId) return { ok: false, status: 400, error: 'Falta el chat o el cliente' }
  try {
    const row = await prisma.crmTask.create({
      data: {
        tenantId: args.tenantId,
        conversationId: args.conversationId ?? null,
        clientId: args.clientId ?? null,
        kind,
        title,
        dueAt,
        assigneeUserId: assignee,
        createdByUserId: args.userId,
      },
      select: taskSelect,
    })
    void recordActivity({
      tenantId: args.tenantId,
      actorUserId: args.userId,
      verb: 'task.create',
      entityType: 'CrmTask',
      entityId: row.id,
      conversationId: row.conversationId,
      clientId: row.clientId,
      props: { kind, due: Boolean(dueAt), assigned: assignee !== args.userId },
    })
    if (assignee && assignee !== args.userId) {
      void notifyUsers({
        tenantId: args.tenantId,
        actorUserId: args.userId,
        kind: 'task_assigned',
        userIds: [assignee],
        dedupeKey: (u) => `task_assigned:${row.id}:${u}`,
        taskId: row.id,
        conversationId: row.conversationId,
        clientId: row.clientId,
      })
    }
    const [task] = await toDtos(args.tenantId, [row])
    return { ok: true, task }
  } catch (error) {
    if (markMissing(error)) return { ok: false, status: 503, error: 'Las tareas aún no están disponibles.' }
    throw error
  }
}

/** Complete / reopen / edit / cancel. Anyone who works chats in the business may do it. */
export async function updateTask(args: {
  tenantId: string
  userId: string
  taskId: string
  status?: unknown
  title?: unknown
  dueAt?: unknown
  assigneeUserId?: unknown
}): Promise<TaskResult> {
  if (tasksKnownMissing()) return { ok: false, status: 503, error: 'Las tareas aún no están disponibles.' }
  try {
    const existing = await prisma.crmTask.findFirst({ where: { id: args.taskId, tenantId: args.tenantId, status: { not: 'canceled' } }, select: taskSelect })
    if (!existing) return { ok: false, status: 404, error: 'Tarea no encontrada' }
    const data: Record<string, unknown> = {}
    let verb = 'task.edit'
    if (args.status !== undefined) {
      if (args.status !== 'open' && args.status !== 'done' && args.status !== 'canceled') return { ok: false, status: 400, error: 'Estado inválido' }
      data.status = args.status
      data.completedAt = args.status === 'done' ? new Date() : null
      data.completedByUserId = args.status === 'done' ? args.userId : null
      verb = args.status === 'done' ? 'task.complete' : args.status === 'canceled' ? 'task.cancel' : 'task.reopen'
    }
    if (args.title !== undefined) {
      const title = normalizeTaskTitle(args.title)
      if (!title) return { ok: false, status: 400, error: `La tarea necesita un título (máx. ${TASK_TITLE_MAX} caracteres).` }
      data.title = title
    }
    if (args.dueAt !== undefined) {
      const dueAt = parseDueAt(args.dueAt)
      if (dueAt === 'invalid') return { ok: false, status: 400, error: 'Fecha inválida' }
      data.dueAt = dueAt
    }
    let newAssignee: string | null = null
    if (args.assigneeUserId !== undefined) {
      const a = await checkAssignee(args.tenantId, args.assigneeUserId)
      if (a === 'invalid') return { ok: false, status: 400, error: 'Esa persona no puede recibir tareas de chats.' }
      data.assigneeUserId = a
      if (a && a !== existing.assigneeUserId && a !== args.userId) newAssignee = a
    }
    if (!Object.keys(data).length) return { ok: false, status: 400, error: 'Nada que actualizar' }
    data.updatedAt = new Date()
    const done = await prisma.crmTask.updateMany({ where: { id: existing.id, tenantId: args.tenantId, status: { not: 'canceled' } }, data })
    if (!done.count) return { ok: false, status: 404, error: 'Tarea no encontrada' }
    const row = await prisma.crmTask.findFirst({ where: { id: existing.id, tenantId: args.tenantId }, select: taskSelect })
    if (!row) return { ok: false, status: 404, error: 'Tarea no encontrada' }
    void recordActivity({
      tenantId: args.tenantId,
      actorUserId: args.userId,
      verb,
      entityType: 'CrmTask',
      entityId: row.id,
      conversationId: row.conversationId,
      clientId: row.clientId,
    })
    if (newAssignee) {
      void notifyUsers({
        tenantId: args.tenantId,
        actorUserId: args.userId,
        kind: 'task_assigned',
        userIds: [newAssignee],
        dedupeKey: (u) => `task_assigned:${row.id}:${u}`,
        taskId: row.id,
        conversationId: row.conversationId,
        clientId: row.clientId,
      })
    }
    const [task] = await toDtos(args.tenantId, [row])
    return { ok: true, task }
  } catch (error) {
    if (markMissing(error)) return { ok: false, status: 503, error: 'Las tareas aún no están disponibles.' }
    throw error
  }
}
