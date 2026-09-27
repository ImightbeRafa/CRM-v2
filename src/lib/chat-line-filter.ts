/**
 * Pure helpers for the Chats "línea" filter (one entry per SocialAccount).
 * Kept free of React so the health cue + counters are unit-testable.
 */

import { classifyChannelHealth, type ChannelHealth } from '@/app/config/social/channel-health'
import type { SoftConversation, SoftSocialAccount } from '@/lib/chat-soft-copilot'

export interface LineCounts {
  /** Conversations not marked "hecho". */
  open: number
  unread: number
}

export interface LineCountsSummary {
  total: LineCounts
  byAccount: Map<string, LineCounts>
}

export function lineHealth(account: SoftSocialAccount): ChannelHealth {
  return classifyChannelHealth({
    ...account,
    linkedAt: '',
    disconnectedAt: account.disconnectedAt ? String(account.disconnectedAt) : null,
  })
}

/** A line is "caída" when it needs repair/reconnect (webhook off, token dead, unlinked). */
export function lineIsDown(account: SoftSocialAccount): boolean {
  return lineHealth(account).needsAction
}

export function summarizeLineCounts(conversations: SoftConversation[]): LineCountsSummary {
  const total: LineCounts = { open: 0, unread: 0 }
  const byAccount = new Map<string, LineCounts>()
  for (const c of conversations) {
    const row = byAccount.get(c.socialAccountId) ?? { open: 0, unread: 0 }
    if (c.status !== 'hecho') {
      row.open += 1
      total.open += 1
    }
    const unread = c.unreadCount || 0
    row.unread += unread
    total.unread += unread
    byAccount.set(c.socialAccountId, row)
  }
  return { total, byAccount }
}

export function filterLineAccounts(accounts: SoftSocialAccount[], query: string): SoftSocialAccount[] {
  const q = query.trim().toLowerCase()
  if (!q) return accounts
  return accounts.filter((a) =>
    `${a.displayName || ''} ${a.providerDisplayName || ''} ${a.providerUsername || ''} ${a.displayPhoneNumber || ''} ${a.accountId}`
      .toLowerCase()
      .includes(q),
  )
}
