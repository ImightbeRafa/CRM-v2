'use client'

import Link from 'next/link'
import {
  accountNeedsReconnect,
  socialReconnectBannerLabel,
  type TokenHealthAccount,
} from '@/lib/social-account-token-health'

type Props = {
  accounts: TokenHealthAccount[]
}

/**
 * Token-health reconnect banners for Soft /chats (Phase 5).
 * Renders outside SoftSlimNav / SoftInboxBuckets / SoftCopilotRail (chrome lock).
 */
export function SoftTokenHealthBanners({ accounts }: Props) {
  const unhealthy = accounts.filter(accountNeedsReconnect)
  if (unhealthy.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-3 pt-2" data-testid="soft-token-health-banners">
      {unhealthy.map((account) => (
        <div
          key={account.id}
          className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          <span>{socialReconnectBannerLabel(account)}</span>
          <Link
            href="/config/social"
            className="shrink-0 font-medium text-amber-900 underline underline-offset-2"
          >
            Reconectar
          </Link>
        </div>
      ))}
    </div>
  )
}
