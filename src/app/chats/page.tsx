import { requirePermission } from '@/lib/auth-helpers'
import { SoftCopilotInbox } from '@/components/chats/SoftCopilotInbox'

export default async function ChatsPage() {
  // Same role gate as POST /api/chat/send (update_sales) — not view_sales.
  await requirePermission('update_sales')
  return <SoftCopilotInbox />
}
