/**
 * Agentes IA 2.0 · C — tell a person when the AI hands a chat over ('handoff') or wants a person to look
 * at it ('review').
 *
 * - 'handoff': if nobody has the chat, it is assigned (person viewing it now → last person who replied in
 *   it → person who most recently replied in any chat → owner → admin; always an active member who can work
 *   chats), then the assignee is notified. Never takes a chat from someone else (conditional write).
 * - 'review': notifies the assignee, or the chat team when nobody has it. Never changes aiMode or assignment.
 * - One bell alert per customer message per reason (no 30-minute bucket as for "La IA no respondió");
 *   repeating the same event for the same message is a no-op.
 * - Reuses kind 'ai_no_reply' (allowed by SQL 049) with an `ai_handoff:` / `ai_review:` key prefix; the
 *   reason is a short code (never customer text). Never throws.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { presenceStore } from '@/lib/chat-presence'
import { filterChatMembers, notifyUsers, HANDOFF_REASON_LABELS } from '@/lib/workspace-notifications'
import { hasPermission, type Role } from '@/lib/rbac'

export type HandoffKind = 'handoff' | 'review'

const MAX_RECIPIENTS = 10
/** Fallback dedupe window when the chat has no customer message (identical events only). */
const SHORT_BUCKET_MS = 2 * 60_000
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const RECENT_TENANT_SENDER_MS = 7 * 24 * 60 * 60_000
const RECENT_CHAT_SENDER_MS = 30 * 24 * 60 * 60_000

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Callers may pass a code ('payment', 'human_request', …), one of the Spanish labels, or an internal reason
 * ("payment_receipt", "opt_out", "validator_failed"); it always becomes one known code.
 */
export function normalizeHandoffReason(reason: string | null | undefined, kind: HandoffKind): string {
  const s = fold(String(reason || ''))
  if (s && Object.prototype.hasOwnProperty.call(HANDOFF_REASON_LABELS, s)) return s
  for (const [code, label] of Object.entries(HANDOFF_REASON_LABELS)) {
    if (s && fold(label) === s) return code
  }
  if (/datos de pago|como pagar|payment_details|payment_data|payment_not_shareable|how_to_pay/.test(s)) {
    return 'payment_details'
  }
  if (/comprobante|pago|sinpe|transfer|deposito|receipt|payment|paid/.test(s)) return 'payment'
  if (/reclamo|devoluci|reembolso|refund|complaint|dispute|queja/.test(s)) return 'complaint'
  if (/persona|humano|human|opt_out|optout|asesor/.test(s)) return 'human_request'
  if (/owner|verbatim/.test(s)) return 'owner_reply'
  return kind === 'review' ? 'review' : 'escalate'
}

export function handoffDedupeKey(kind: HandoffKind, conversationId: string, anchor: string, code: string): string {
  return `${kind === 'handoff' ? 'ai_handoff' : 'ai_review'}:${conversationId}:${anchor}:${code}`
}

/** Anchor = the customer message being handled; without one, a short time bucket (identical events only). */
export function handoffAnchor(lastInboundMessageId: string | null | undefined, now = Date.now()): string {
  return lastInboundMessageId && ID_RE.test(lastInboundMessageId)
    ? lastInboundMessageId
    : `t${Math.floor(now / SHORT_BUCKET_MS)}`
}

/** Candidate order for a new assignee; duplicates and empties removed, first eligible wins. */
export function orderAssigneeCandidates(groups: Array<Array<string | null | undefined>>): string[] {
  const out: string[] = []
  for (const group of groups) {
    for (const id of group) {
      if (id && !out.includes(id)) out.push(id)
    }
  }
  return out
}

export function pickFirstEligible(candidates: string[], eligible: ReadonlySet<string>): string | null {
  return candidates.find((id) => eligible.has(id)) || null
}

async function chatTeam(tenantId: string): Promise<string[]> {
  const members = await prisma.membership.findMany({
    where: { tenantId, isActive: true, user: { active: true } },
    select: { userId: true, role: true },
    take: 50,
  })
  return members
    .filter((m) => hasPermission(m.role as Role, 'update_sales'))
    .map((m) => m.userId)
    .slice(0, MAX_RECIPIENTS)
}

async function pickHandoffAssignee(tenantId: string, conversationId: string): Promise<string | null> {
  const now = Date.now()
  const viewing = presenceStore.list(tenantId, conversationId, '').map((p) => p.userId)
  const [chatSenders, tenantSenders, admins] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        tenantId,
        conversationId,
        direction: 'outbound',
        senderUserId: { not: null },
        sentAt: { gte: new Date(now - RECENT_CHAT_SENDER_MS) },
      },
      orderBy: { sentAt: 'desc' },
      take: 10,
      select: { senderUserId: true },
    }),
    prisma.chatMessage.findMany({
      where: {
        tenantId,
        direction: 'outbound',
        senderUserId: { not: null },
        sentAt: { gte: new Date(now - RECENT_TENANT_SENDER_MS) },
      },
      orderBy: { sentAt: 'desc' },
      take: 30,
      select: { senderUserId: true },
    }),
    prisma.membership.findMany({
      where: { tenantId, isActive: true, user: { active: true }, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { joinedAt: 'asc' },
      select: { userId: true, role: true },
      take: 10,
    }),
  ])
  const ownersFirst = [...admins].sort((a, b) => (a.role === b.role ? 0 : a.role === 'OWNER' ? -1 : 1))
  const candidates = orderAssigneeCandidates([
    viewing,
    chatSenders.map((m) => m.senderUserId),
    tenantSenders.map((m) => m.senderUserId),
    ownersFirst.map((m) => m.userId),
  ]).slice(0, 60)
  const eligible = new Set(await filterChatMembers(tenantId, candidates))
  return pickFirstEligible(candidates, eligible)
}

export async function notifyHandoff(input: {
  tenantId: string
  conversationId: string
  socialAccountId?: string | null
  kind: 'handoff' | 'review'
  reason: string
}): Promise<void> {
  try {
    if (!input.tenantId || !input.conversationId) return
    if (input.kind !== 'handoff' && input.kind !== 'review') return
    const conv = await prisma.chatConversation.findFirst({
      where: {
        id: input.conversationId,
        tenantId: input.tenantId,
        ...(input.socialAccountId ? { socialAccountId: input.socialAccountId } : {}),
      },
      select: { id: true, assignedUserId: true },
    })
    if (!conv) return

    const code = normalizeHandoffReason(input.reason, input.kind)
    const lastInbound = await prisma.chatMessage.findFirst({
      where: { tenantId: input.tenantId, conversationId: conv.id, direction: 'inbound' },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })

    let assignee: string | null = null
    if (conv.assignedUserId) {
      assignee = (await filterChatMembers(input.tenantId, [conv.assignedUserId]))[0] || null
    }
    if (!assignee && !conv.assignedUserId && input.kind === 'handoff') {
      const pick = await pickHandoffAssignee(input.tenantId, conv.id)
      if (pick) {
        // Conditional: never takes the chat from someone who got it in the meantime.
        const res = await prisma.chatConversation.updateMany({
          where: { id: conv.id, tenantId: input.tenantId, assignedUserId: null },
          data: { assignedUserId: pick },
        })
        if (res.count === 1) {
          assignee = pick
        } else {
          const now = await prisma.chatConversation.findFirst({
            where: { id: conv.id, tenantId: input.tenantId },
            select: { assignedUserId: true },
          })
          assignee = now?.assignedUserId
            ? (await filterChatMembers(input.tenantId, [now.assignedUserId]))[0] || null
            : null
        }
      }
    }

    const userIds = assignee ? [assignee] : await chatTeam(input.tenantId)
    if (!userIds.length) return
    const key = handoffDedupeKey(input.kind, conv.id, handoffAnchor(lastInbound?.id), code)
    await notifyUsers({
      tenantId: input.tenantId,
      actorUserId: null,
      kind: 'ai_no_reply',
      userIds,
      dedupeKey: () => key,
      conversationId: conv.id,
    })
  } catch (error) {
    console.error('[soft-ai/handoff-notify]', error instanceof Error ? error.name : 'unknown')
  }
}
