'use client'

import { useEffect, useState } from 'react'
import { classifyChannelHealth, isOwnerChannel } from '@/app/config/social/channel-health'
import type { SocialAccount } from '@/app/config/social/types'

export type ChannelsSummary = {
  /** Owner-visible channels (WhatsApp / Instagram lines). */
  accounts: SocialAccount[]
  /** Channels whose health tone needs action (warn / bad). */
  needsAction: number
}

const TTL_MS = 60_000
let cache: { at: number; value: ChannelsSummary } | null = null
let inflight: Promise<ChannelsSummary | null> | null = null

function summarize(accounts: SocialAccount[]): ChannelsSummary {
  const owned = accounts.filter(isOwnerChannel)
  const needsAction = owned.filter((a) => {
    const tone = classifyChannelHealth(a).tone
    return tone === 'warn' || tone === 'bad'
  }).length
  return { accounts: owned, needsAction }
}

function load(): Promise<ChannelsSummary | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value)
  if (inflight) return inflight
  inflight = fetch('/api/chat/accounts?includeInactive=1')
    .then((r) => r.json())
    .then((json) => {
      if (!json?.success) return null
      const value = summarize(json.accounts as SocialAccount[])
      cache = { at: Date.now(), value }
      return value
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop the cached summary (call after connecting / repairing a line). */
export function invalidateChannelsSummary() {
  cache = null
}

/**
 * Real channel data shared by the Config hub and the sub-nav badge (one request per minute).
 * `summary` is `null` while loading; `failed` is true when the request errored.
 */
export function useChannelsSummary(): { summary: ChannelsSummary | null; failed: boolean; reload: () => void } {
  const [summary, setSummary] = useState<ChannelsSummary | null>(cache?.value ?? null)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    load().then((value) => {
      if (cancelled) return
      if (value) setSummary(value)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [nonce])

  return {
    summary,
    failed,
    reload: () => {
      invalidateChannelsSummary()
      setNonce((n) => n + 1)
    },
  }
}

/** Count of channels needing action, or `0` while loading / on error (badge stays hidden). */
export function useChannelsNeedingAction(): number {
  return useChannelsSummary().summary?.needsAction ?? 0
}
