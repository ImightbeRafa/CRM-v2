'use client'

import { SoftCopilotInboxLegacy } from '@/components/chats/SoftCopilotInboxLegacy'
import { SoftCopilotInboxV2 } from '@/components/chats/SoftCopilotInboxV2'

export function SoftCopilotInbox({ inboxV2 = false }: { inboxV2?: boolean }) {
  if (inboxV2) return <SoftCopilotInboxV2 />
  return <SoftCopilotInboxLegacy />
}
