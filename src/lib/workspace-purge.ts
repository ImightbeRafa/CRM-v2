/**
 * Before chats are deleted (Meta data-deletion callback, a line / tenant purge): remove the
 * workspace rows that belong ONLY to those chats — "solo este chat" notes and tasks without a
 * client. Otherwise the chat deletion would leave them orphaned (note text with customer data
 * surviving the deletion, SecureDog DATA-13). Rows also tied to a client stay with the client.
 * Never throws for missing tables (before 035 / 036).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'

export async function purgeChatOnlyWorkspaceData(conversationIds: string[]): Promise<{ notes: number; tasks: number }> {
  const out = { notes: 0, tasks: 0 }
  if (!conversationIds.length) return out
  for (let i = 0; i < conversationIds.length; i += 1000) {
    const ids = conversationIds.slice(i, i + 1000)
    try {
      out.notes += (await prisma.crmNote.deleteMany({ where: { conversationId: { in: ids }, clientId: null } })).count
    } catch (error) {
      if (!isMissingRelation(error)) throw error
    }
    try {
      out.tasks += (await prisma.crmTask.deleteMany({ where: { conversationId: { in: ids }, clientId: null } })).count
    } catch (error) {
      if (!isMissingRelation(error)) throw error
    }
  }
  return out
}
