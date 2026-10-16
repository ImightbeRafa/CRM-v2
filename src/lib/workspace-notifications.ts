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
import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'

export const MENTION_MAX = 10
export type NotificationKind =
  | 'mention'
  | 'task_assigned'
  | 'task_due'
  | 'chat_assigned'
  | 'ai_no_reply'
  | 'ai_budget'
  | 'payment_review'
  | 'order_review'

/** Plain-word reasons for "La IA no respondió" (the reason travels in the dedupe key; no customer text). */
export const AI_NO_REPLY_REASONS: Record<string, string> = {
  needs_human: 'Necesita a una persona (no estaba segura de la respuesta).',
  fallback_used: 'No pudo armar una respuesta confiable.',
  escalate: 'El cliente pidió una persona o es un tema delicado.',
  not_activated: 'El agente de este canal no está activado.',
  window_closed: 'Pasaron más de 24 h desde el último mensaje del cliente.',
  budget_blocked: 'Se alcanzó el límite diario de IA.',
  token_unhealthy: 'La conexión del canal necesita revisión.',
  empty_output: 'La respuesta quedó vacía y no se envió.',
}

/**
 * Agentes IA 2.0 · C — why the AI passed a chat to a person ('handoff') or asks a person to look ('review').
 * Codes travel in the dedupe key (`ai_handoff:` / `ai_review:` prefix, kind 'ai_no_reply'); no customer text.
 */
export const HANDOFF_REASON_LABELS: Record<string, string> = {
  payment: 'Comprobante de pago',
  order_ready: 'Pedido contra entrega por confirmar',
  payment_details: 'Hay que pasarle los datos de pago',
  human_request: 'Pidió hablar con una persona',
  complaint: 'Reclamo o devolución',
  owner_reply: 'Respuesta que debe dar una persona',
  escalate: 'Necesita a una persona',
  review: 'Revisar respuesta de la IA',
}

/** Handoff / review alerts reuse kind 'ai_no_reply' (already allowed by SQL 049); the key prefix tells them apart. */
export function handoffNotificationText(dedupeKey: string, where: string): { title: string; snippet: string } | null {
  const parts = String(dedupeKey || '').split(':')
  if (parts[0] !== 'ai_handoff' && parts[0] !== 'ai_review') return null
  const snippet = HANDOFF_REASON_LABELS[parts[3] || ''] || (parts[0] === 'ai_handoff' ? 'Necesita a una persona' : 'Revisá el chat.')
  return parts[0] === 'ai_handoff'
    ? { title: `La IA te pasó un chat${where}`, snippet }
    : { title: `Revisá un chat de la IA${where}`, snippet }
}

/**
 * Agentes IA 2.0 · notify — hand-offs where money / an order is waiting on a person get their own kind
 * (allowed by SQL 049): 'payment' (receipt to verify) → payment_review, 'order_ready' (cash-on-delivery
 * order complete) → order_review. Every other code keeps 'ai_no_reply'.
 */
export type ReviewNotificationKind = 'payment_review' | 'order_review'

export function reviewKindForHandoffCode(code: string | null | undefined): ReviewNotificationKind | null {
  if (code === 'payment') return 'payment_review'
  if (code === 'order_ready') return 'order_review'
  return null
}

export function isReviewNotificationKind(kind: string | null | undefined): kind is ReviewNotificationKind {
  return kind === 'payment_review' || kind === 'order_review'
}

/**
 * 'payment' covers a photo / file receipt AND text-only "ya pagué" claims, model payment escalations and
 * fail-closed payment messages. Only a media receipt says "Mandó el comprobante"; the others are a 'claim'.
 * A claim travels as a `:claim` suffix on the dedupe key (no new column, no customer text).
 */
export type PaymentReviewVariant = 'receipt' | 'claim'
export const PAYMENT_CLAIM_KEY_SUFFIX = ':claim'

/** The hand-off's customer message was a photo / file (the receipt plan only hands off media of these types). */
export function paymentReviewVariant(lastInboundMessageType: string | null | undefined): PaymentReviewVariant {
  const t = String(lastInboundMessageType || '').toLowerCase()
  return t === 'image' || t === 'document' ? 'receipt' : 'claim'
}

export function paymentVariantFromDedupeKey(dedupeKey: string | null | undefined): PaymentReviewVariant {
  return String(dedupeKey || '').endsWith(PAYMENT_CLAIM_KEY_SUFFIX) ? 'claim' : 'receipt'
}

/**
 * SecureDog DATA-54: a customer-controlled display name / number shown in the bell and toast. No control,
 * format or bidi characters (no RTL spoofing, no fake line breaks), spaces collapsed, at most 40 characters.
 */
export const NOTIFICATION_NAME_MAX = 40
export function sanitizeNotificationName(who: string | null | undefined): string {
  return Array.from(
    stripFormatChars(String(who || ''))
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, NOTIFICATION_NAME_MAX)
    .join('')
    .trim()
}

/** Bell / toast text for a review alert. `who` = customer name, else number / handle. No message text. */
export function reviewNotificationText(
  kind: ReviewNotificationKind,
  who: string | null | undefined,
  variant: PaymentReviewVariant = 'receipt',
): { title: string; snippet: string } {
  const name = sanitizeNotificationName(who) || 'un cliente'
  if (kind === 'payment_review') {
    return {
      title: `💳 Verificá un pago · ${name}`,
      snippet:
        variant === 'receipt'
          ? 'Mandó el comprobante — revisalo y confirmá el pedido'
          : 'Dice que ya pagó o tiene una duda de pago — revisalo',
    }
  }
  return { title: `📦 Pedido por confirmar · ${name}`, snippet: 'Pidió contra entrega — confirmá los datos' }
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
      convIds.length ? prisma.chatConversation.findMany({ where: { tenantId, id: { in: convIds } }, select: { id: true, peerName: true, peerId: true } }) : [],
    ])
    const noteById = new Map(notes.map((n) => [n.id, n]))
    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const actorName = new Map(actors.map((a) => [a.id, staffDisplayName(a.name, a.username) || 'Alguien del equipo']))
    const peer = new Map(convs.map((c) => [c.id, c.peerName]))
    const peerId = new Map(convs.map((c) => [c.id, c.peerId]))

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
      } else if (r.kind === 'ai_budget') {
        // ai_budget:paused:<tenant>:<month> (business team) or ai_budget:<scope>:<month>:<level> (platform owner)
        const parts = String(r.dedupeKey || '').split(':')
        const paused = parts[1] === 'paused'
        items.push({
          id: r.id,
          kind: 'ai_budget',
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: paused ? 'La IA de tu negocio quedó en pausa' : `IA: ${parts[3] || ''}% del presupuesto del mes`,
          snippet: paused
            ? 'Se alcanzó el límite mensual de IA. Atiendan los chats a mano; Betsy ya fue avisado.'
            : 'Revisá el detalle en Uso de IA.',
          href: paused ? '/chats' : '/super-admin/ia',
        })
      } else if (isReviewNotificationKind(r.kind)) {
        const who = r.conversationId ? peer.get(r.conversationId) || peerId.get(r.conversationId) : null
        const text = reviewNotificationText(r.kind, who, paymentVariantFromDedupeKey(r.dedupeKey))
        items.push({
          id: r.id,
          kind: r.kind,
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: text.title,
          snippet: text.snippet,
          href: chatHref(r.conversationId, r.clientId),
        })
      } else if (r.kind === 'ai_no_reply' && handoffNotificationText(r.dedupeKey, where)) {
        const text = handoffNotificationText(r.dedupeKey, where) as { title: string; snippet: string }
        items.push({
          id: r.id,
          kind: 'ai_no_reply',
          read: Boolean(r.readAt),
          createdAt: r.createdAt.toISOString(),
          title: text.title,
          snippet: text.snippet,
          href: chatHref(r.conversationId, r.clientId),
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
