import { requirePermission } from '@/lib/auth-helpers'
import { SoftCopilotInbox } from '@/components/chats/SoftCopilotInbox'
import { shouldUseChatInboxV2 } from '@/lib/feature-flags'

export default async function ChatsPage() {
  // Same role gate as POST /api/chat/send (update_sales) — not view_sales.
  const { session } = await requirePermission('update_sales')
  const tenantId = (session.user as { tenantId?: string }).tenantId
  const inboxV2 = tenantId ? await shouldUseChatInboxV2(tenantId) : false
  return <SoftCopilotInbox inboxV2={inboxV2} />
}
