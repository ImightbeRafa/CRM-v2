'use client'

import { SoftCopilotInboxV2 } from '@/components/chats/SoftCopilotInboxV2'

/**
 * Aurora /chats always renders the V2 inbox (server-grouped list + changes feed).
 * `SoftCopilotInboxLegacy` stays in the repo for rollback but is no longer mounted
 * or Aurora-skinned; `inboxV2` is accepted only so old call sites keep compiling.
 */
export function SoftCopilotInbox(_props: { inboxV2?: boolean } = {}) {
  return <SoftCopilotInboxV2 />
}
