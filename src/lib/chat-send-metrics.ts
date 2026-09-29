/**
 * Activity metrics recorded after a HUMAN send (Phase 2b, 2026-09-29):
 * - `chat.quick_reply.used` — which quick reply shortcut the agent inserted (sanitized key only);
 * - `chat.first_response`   — ms from the chat's first inbound message to the team's first human
 *   reply (once per chat, dedupe key `first_response:<conversationId>`).
 *
 * Fire-and-forget: callers use `void recordHumanSendMetrics(...)`; it never throws and never
 * delays the send response. AI / automated outbound (no senderUserId) never counts.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { recordActivity } from '@/lib/activity'
import { normalizeShortcut } from '@/lib/chat-quick-replies'

const SHORTCUT_RE = /^[a-z0-9_-]{1,40}$/

/** The client's claim of "quick reply used": kept only if it is a well-formed shortcut. */
export function sanitizeQuickReplyShortcut(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 60) return null
  const key = normalizeShortcut(raw)
  return SHORTCUT_RE.test(key) ? key : null
}

export function firstResponseDedupeKey(conversationId: string): string {
  return `first_response:${conversationId}`
}

/** Pure: response time in ms, or null when it cannot be a first response. */
export function firstResponseMs(firstInboundAt: Date | null, firstHumanReplyAt: Date | null): number | null {
  if (!firstInboundAt || !firstHumanReplyAt) return null
  const ms = firstHumanReplyAt.getTime() - firstInboundAt.getTime()
  return ms >= 0 ? ms : null
}

export async function recordHumanSendMetrics(args: {
  tenantId: string
  conversationId: string
  userId: string
  /** The message just written by this send. */
  messageId: string
  quickReplyShortcut?: unknown
  media?: boolean
  surface?: string
}): Promise<void> {
  try {
    const shortcut = sanitizeQuickReplyShortcut(args.quickReplyShortcut)
    if (shortcut) {
      void recordActivity({
        tenantId: args.tenantId,
        actorUserId: args.userId,
        verb: 'chat.quick_reply.used',
        entityType: 'ChatMessage',
        entityId: args.messageId,
        conversationId: args.conversationId,
        surface: args.surface ?? 'chats',
        props: { shortcut, media: Boolean(args.media) },
      })
    }

    const dedupeKey = firstResponseDedupeKey(args.conversationId)
    // Cheap exit on the unique (tenantId, dedupeKey) index: already measured for this chat.
    const done = await prisma.activityEvent.findFirst({ where: { tenantId: args.tenantId, dedupeKey }, select: { id: true } })
    if (done) return
    const [firstInbound, firstHuman] = await Promise.all([
      prisma.chatMessage.findFirst({
        where: { tenantId: args.tenantId, conversationId: args.conversationId, direction: 'inbound' },
        orderBy: { sentAt: 'asc' },
        select: { sentAt: true },
      }),
      prisma.chatMessage.findFirst({
        where: { tenantId: args.tenantId, conversationId: args.conversationId, direction: 'outbound', senderUserId: { not: null } },
        orderBy: { sentAt: 'asc' },
        select: { id: true, sentAt: true },
      }),
    ])
    // Only the send that IS the first human reply records it (a later send finds an earlier one).
    if (!firstHuman || firstHuman.id !== args.messageId) return
    const ms = firstResponseMs(firstInbound?.sentAt ?? null, firstHuman.sentAt)
    if (ms === null) return
    await recordActivity({
      tenantId: args.tenantId,
      actorUserId: args.userId,
      verb: 'chat.first_response',
      entityType: 'ChatConversation',
      entityId: args.conversationId,
      conversationId: args.conversationId,
      surface: args.surface ?? 'chats',
      props: { ms },
      dedupeKey,
    })
  } catch (error) {
    // Metrics must never break a send (includes "ActivityEvent missing" before 035).
    console.warn('[chat-metrics] skipped', error instanceof Error ? error.message : error)
  }
}
