/**
 * Agentes · per-SocialAccount bind helpers (pure, client-safe).
 * Bind model: each WhatsApp number / Instagram account is its own SocialAccount row.
 * An agent with no attended rows attends nobody — there is no "all WhatsApp" default.
 */

import { formatInstagramHandle } from '@/lib/social-account-identity'

export type BindChannelLike = {
  id: string
  platform: string
  displayName: string | null
  displayPhoneNumber: string | null
  providerUsername: string | null
  attendedByThisAgent: boolean
  aiAllowed?: boolean
}

export type ChannelIdentity = {
  /** Primary line label (custom name, else phone / @handle). */
  title: string
  /** Concrete identity (phone or @handle) when it adds info beyond `title`; else null. */
  detail: string | null
  platformLabel: 'WhatsApp' | 'Instagram'
}

export function channelIdentity(row: BindChannelLike): ChannelIdentity {
  const isIg = row.platform.toLowerCase() === 'instagram'
  const name = row.displayName?.trim() || null
  const handle = formatInstagramHandle(row.providerUsername)
  const phone = row.displayPhoneNumber?.trim() || null
  const concrete = isIg ? handle : phone
  const platformLabel = isIg ? 'Instagram' : 'WhatsApp'
  const title = name || concrete || `${platformLabel} · canal`
  return {
    title,
    detail: concrete && concrete !== title ? concrete : null,
    platformLabel,
  }
}

export type BindSummary = {
  total: number
  attending: number
  aiAllowed: number
  /** True when the agent has no bound line: it attends nobody. */
  attendsNobody: boolean
}

export function summarizeBind(rows: BindChannelLike[]): BindSummary {
  const attending = rows.filter((r) => r.attendedByThisAgent).length
  return {
    total: rows.length,
    attending,
    aiAllowed: rows.filter((r) => r.attendedByThisAgent && r.aiAllowed).length,
    attendsNobody: attending === 0,
  }
}
