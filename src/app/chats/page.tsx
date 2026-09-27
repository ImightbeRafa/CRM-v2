import { requirePermission } from '@/lib/auth-helpers'
import { SoftCopilotInbox } from '@/components/chats/SoftCopilotInbox'

export default async function ChatsPage() {
  // Same role gate as POST /api/chat/send (update_sales) — not view_sales.
  await requirePermission('update_sales')
  // Aurora uses the V2 inbox only; the chat_inbox_v2 tenant flag no longer selects the UI.
  return <SoftCopilotInbox />
}
