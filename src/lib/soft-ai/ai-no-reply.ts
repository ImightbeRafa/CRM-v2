/**
 * "La IA no respondió" — when an activated agent stays silent on a customer message it should have answered,
 * the chat's assignee (or, if nobody is assigned, the team members who work chats) gets a bell notification
 * with the reason in plain words. Never throws; at most one alert per chat per 30 minutes.
 * Reasons that are expected silence (a person already replied, chat paused / taken over, newer message,
 * kill switch) never alert.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { filterChatMembers, notifyUsers, AI_NO_REPLY_REASONS } from '@/lib/workspace-notifications'
import { hasPermission, type Role } from '@/lib/rbac'

export const AI_NO_REPLY_ALERT_REASONS = new Set(Object.keys(AI_NO_REPLY_REASONS))
const BUCKET_MS = 30 * 60_000
const MAX_RECIPIENTS = 10

export function aiNoReplyDedupeKey(conversationId: string, reason: string, now = Date.now()): string {
  return `ai_no_reply:${conversationId}:${Math.floor(now / BUCKET_MS)}:${reason}`
}

export async function notifyAiNoReply(input: { tenantId: string; conversationId: string; reason: string | null | undefined }) {
  const reason = input.reason || ''
  if (!AI_NO_REPLY_ALERT_REASONS.has(reason)) return
  try {
    const conv = await prisma.chatConversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      select: { assignedUserId: true },
    })
    if (!conv) return
    let userIds: string[] = []
    if (conv.assignedUserId) {
      userIds = [conv.assignedUserId]
    } else {
      const members = await prisma.membership.findMany({
        where: { tenantId: input.tenantId, isActive: true, user: { active: true } },
        select: { userId: true, role: true },
        take: 50,
      })
      userIds = members.filter((m) => hasPermission(m.role as Role, 'update_sales')).map((m) => m.userId).slice(0, MAX_RECIPIENTS)
    }
    userIds = await filterChatMembers(input.tenantId, userIds)
    if (!userIds.length) return
    // One key per chat per 30-minute bucket (not per user): the reason rides in the key for the bell text.
    const key = aiNoReplyDedupeKey(input.conversationId, reason)
    await notifyUsers({
      tenantId: input.tenantId,
      actorUserId: null,
      kind: 'ai_no_reply',
      userIds,
      dedupeKey: () => key,
      conversationId: input.conversationId,
    })
  } catch (error) {
    console.error('[soft-ai/ai-no-reply]', error instanceof Error ? error.name : 'unknown')
  }
}
