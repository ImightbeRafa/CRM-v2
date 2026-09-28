import 'server-only'

import { isActiveTenantMember } from '@/lib/chat-conversation-route-helpers'

type ConversationUpdater = {
  chatConversation: {
    updateMany: (args: {
      where: { id: string; tenantId: string; assignedUserId: null }
      data: { assignedUserId: string }
    }) => Promise<{ count: number }>
  }
}

/**
 * Auto-assign (Rafael 2026-09-28): the first human who actually replies to an unassigned
 * chat becomes its owner. Conditional write (`assignedUserId: null`), so it never takes a
 * chat from someone else and concurrent replies cannot both win. Never throws.
 */
export async function autoAssignOnFirstHumanReply(
  db: ConversationUpdater,
  args: { tenantId: string; conversationId: string; userId: string },
  isMember: (tenantId: string, userId: string) => Promise<boolean> = isActiveTenantMember,
): Promise<boolean> {
  try {
    if (!args.userId || !(await isMember(args.tenantId, args.userId))) return false
    const result = await db.chatConversation.updateMany({
      where: { id: args.conversationId, tenantId: args.tenantId, assignedUserId: null },
      data: { assignedUserId: args.userId },
    })
    return result.count > 0
  } catch (error) {
    console.warn('[chat] auto-assign skipped', error instanceof Error ? error.message : error)
    return false
  }
}
