/**
 * In-app notifications for one teammate (Phase 2b, migration 036): @mentions in internal notes and
 * tasks assigned to you. Shown in the Aurora bell.
 *
 * - Tenant + recipient scoped everywhere: a user only ever lists / marks their own rows.
 * - Recipients must be active members of the business who can work chats (update_sales).
 * - No note text is copied: the list joins the live note and hides deleted ones (DATA-10).
 * - Tolerates 036 not being applied (memoized "table missing": features stay hidden).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { staffDisplayName } from '@/lib/display-name'
import { hasPermission, type Role } from '@/lib/rbac'

export const MENTION_MAX = 10
export type NotificationKind = 'mention' | 'task_assigned' | 'task_due' | 'chat_assigned' | 'ai_no_reply'

/** Plain-word reasons for "La IA no respondió" (the reason travels in the dedupe key; no customer text). */
export const AI_NO_REPLY_REASONS: Record<string, string> = {
  needs_human: 'Necesita a una persona (no estaba segura de la respuesta).',
  fallback_used: 'No pudo armar una respuesta confiable.',
  escalate: 'El cliente pidió una persona o es un tema delicado.',
  not_activated: 'El agente de este canal no está activado.',
  window_closed: 'Pasaron más de 24 h desde el último mensaje del cliente.',
  budget_blocked: 'Se alcanzó el límite diario de IA.',
  token_unhealthy: 'La conexión del canal necesita revisión.',
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
let tableMissingUntil = 0
const MISSING_TTL_MS = 5 * 60_000

function markMissing(error: unknown): boolean {
  if (!isMissingRelation(error)) return false
  tableMissingUntil = Date.now() + MISSING_TTL_MS
  return true
}

export function notificationsKnownMissing(): boolean {
  return Date.now() < tableMissingUntil
}

/** Client-sent mention ids: strings of id shape, unique, never the author, at most 10. */
export function normalizeMentionIds(raw: unknown, authorUserId: string): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string' || !ID_RE.test(v) || v === authorUserId || out.includes(v)) continue
    out.push(v)
    if (out.length >= MENTION_MAX) break
  }
  return out
}

/** Keeps only active members of THIS business whose role can work chats. */
export async function filterChatMembers(tenantId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return []
  const rows = await prisma.membership.findMany({
    where: { tenantId, userId: { in: userIds }, isActive: true, user: { active: true } },
    select: { userId: true, role: true },
  })
  const ok = new Set(rows.filter((r) => hasPermission(r.role as Role, 'update_sales')).map((r) => r.userId))
  return userIds.filter((id) => ok.has(id))
}

export async function notifyUsers(input: {
  tenantId: string
  actorUserId: string | null
  kind: NotificationKind
  userIds: string[]
  /** Unique per recipient: re-notifying the same thing is a no-op. */
  dedupeKey: (userId: string) => string
  noteId?: string | null
  taskId?: string | null
  conversationId?: string | null
  clientId?: string | null
}): Promise<number> {
  const wanted = input.userIds.filter((u) => u && u !== input.actorUserId)
  if (!wanted.length || notificationsKnownMissing()) return 0
  try {
    // Defence in depth (DATA-14): only chat members of THIS business, whatever the caller passed.
    const userIds = await filterChatMembers(input.tenantId, wanted)
    if (!userIds.length) return 0
    const res = await prisma.workspaceNotification.createMany({
      data: userIds.map((userId) => ({
        tenantId: input.tenantId,
        userId,
        actorUserId: input.actorUserId,
        kind: input.kind,
        noteId: input.noteId ?? null,
        taskId: input.taskId ?? null,
        conversationId: input.conversationId ?? null,
        clientId: input.clientId ?? null,
        dedupeKey: input.dedupeKey(userId).slice(0, 200),
      })),
      skipDuplicates: true,
    })
    return res.count
  } catch (error) {
    if (markMissing(error)) return 0
    // Never break the action that triggered the notification.
    console.warn('[notifications] not created', error instanceof Error ? error.message : error)
    return 0
  }
}

export type NotificationDto = {
  id: string
  kind: NotificationKind
  read: boolean
  createdAt: string
  title: string
  snippet: string | null
  href: string
}

function chatHref(conversationId: string | null, clientId: string | null): string {
  if (conversationId) return `/chats?c=${encodeURIComponent(conversationId)}`
  if (clientId) return `/chats`
  return '/tareas'
}

export async function listNotifications(tenantId: string, userId: string, limit = 30): Promise<{ available: boolean; unread: number; items: NotificationDto[] }> {
  if (notificationsKnownMissing()) return { available: false, unread: 0, items: [] }
  try {
    const [rows, unread] = await Promise.all([
      prisma.workspaceNotification.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 50),
      }),
      prisma.workspaceNotification.count({ where: { tenantId, userId, readAt: null } }),
    ])
    const noteIds = rows.map((r) => r.noteId).filter((x): x is string => Boolean(x))
    const taskIds = rows.map((r) => r.taskId).filter((x): x is string => Boolean(x))
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)))]
    const convIds = [...new Set(rows.map((r) => r.conversationId).filter((x): x is string => Boolean(x)))]
    const [notes, tasks, actors, convs] = await Promise.all([
      noteIds.length ? prisma.crmNote.findMany({ where: { tenantId, id: { in: noteIds } }, select: { id: true, body: true, deletedAt: true } }) : [],
      taskIds.length ? prisma.crmTask.findMany({ where: { tenantId, id: { in: taskIds } }, select: { id: true, title: true, status: true } }) : [],
      actorIds.length ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, username: true } }) : [],
      convIds.length ? prisma.chatConversation.findMany({ where: { tenantId, id: { in: convIds } }, select: { id: true, peerName: true } }) : [],
    ])
    const noteById = new Map(notes.map((n) => [n.id, n]))
    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const actorName = new Map(actors.map((a) => [a.id, staffDisplayName(a.name, a.username) || 'Alguien del equipo']))
    const peer = new Map(convs.map((c) => [c.id, c.peerName]))

    const items: NotificationDto[] = []
    const hidden: string[] = []
    for (const r of rows) {
      const who = (r.actorUserId && actorName.get(r.actorUserId)) || 'Alguien del equipo'
      const where = r.conversationId && peer.get(r.conversationId) ? ` · ${peer.get(r.conversationId)}` : ''
      if (r.kind === 'mention') {
        const note = r.noteId ? noteById.get(r.noteId) : undefined
        // A deleted (wiped) note is never shown again.
        if (!note || note.deletedAt) {
          if (!r.readAt) hidden.push(r.id)
          continue
        }
        items.push({
          id: r.id,
          kind: 'mention',
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: `${who} te mencionó${where}`,
          snippet: note.body.length > 140 ? `${note.body.slice(0, 139)}…` : note.body,
          href: chatHref(r.conversationId, r.clientId),
        })
      } else if (r.kind === 'task_assigned' || r.kind === 'task_due') {
        const task = r.taskId ? taskById.get(r.taskId) : undefined
        if (!task || task.status === 'canceled') {
          if (!r.readAt) hidden.push(r.id)
          continue
        }
        items.push({
          id: r.id,
          kind: r.kind as NotificationKind,
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: r.kind === 'task_assigned' ? `${who} te asignó una tarea${where}` : `Tarea vencida${where}`,
          snippet: task.title,
          href: r.conversationId ? chatHref(r.conversationId, r.clientId) : '/tareas',
        })
      } else if (r.kind === 'ai_no_reply') {
        const reason = String(r.dedupeKey || '').split(':')[3] || ''
        items.push({
          id: r.id,
          kind: 'ai_no_reply',
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: `La IA no respondió${where}`,
          snippet: AI_NO_REPLY_REASONS[reason] || 'Revisá el chat.',
          href: chatHref(r.conversationId, r.clientId),
        })
      } else {
        items.push({
          id: r.id,
          kind: r.kind as NotificationKind,
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: `${who} te asignó un chat${where}`,
          snippet: null,
          href: chatHref(r.conversationId, r.clientId),
        })
      }
    }
    // Notifications that can no longer be shown (deleted note, canceled task) never keep the dot on.
    if (hidden.length) {
      void prisma.workspaceNotification.updateMany({ where: { tenantId, userId, id: { in: hidden }, readAt: null }, data: { readAt: new Date() } }).catch(() => undefined)
    }
    return { available: true, unread: Math.max(0, unread - hidden.length), items }
  } catch (error) {
    if (markMissing(error)) return { available: false, unread: 0, items: [] }
    throw error
  }
}

/** Marks MY notifications read (all, or the given ids). Never touches someone else's rows. */
export async function markNotificationsRead(tenantId: string, userId: string, ids?: unknown): Promise<number> {
  if (notificationsKnownMissing()) return 0
  const idList = Array.isArray(ids) ? ids.filter((v): v is string => typeof v === 'string' && ID_RE.test(v)).slice(0, 100) : null
  try {
    const res = await prisma.workspaceNotification.updateMany({
      where: { tenantId, userId, readAt: null, ...(idList ? { id: { in: idList } } : {}) },
      data: { readAt: new Date() },
    })
    return res.count
  } catch (error) {
    if (markMissing(error)) return 0
    throw error
  }
}
