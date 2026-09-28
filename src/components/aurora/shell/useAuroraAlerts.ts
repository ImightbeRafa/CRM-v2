'use client'

import { useEffect, useMemo, useState } from 'react'
import { useChannelsSummary } from '@/components/aurora/config/useChannelsNeedingAction'
import { buildAuroraAlerts, type AuroraAlert } from '@/lib/aurora-alerts'
import { matchesTab, paymentChip } from '@/lib/pedidos-aurora'
import { parseOrder } from '@/app/hooks/useSalesStream'
import { useAuroraViewer } from './useAuroraViewer'

type Signals = {
  metaReady: boolean | null
  unassigned: { count: number; more: boolean }
  sinpePending: number
  porEnviar: number
}

const EMPTY: Signals = {
  metaReady: null,
  unassigned: { count: 0, more: false },
  sinpePending: 0,
  porEnviar: 0,
}

const TTL_MS = 60_000
const CR_TZ = 'America/Costa_Rica'
const cache = new Map<string, { at: number; value: Signals }>()
const inflight = new Map<string, Promise<Signals>>()

/** Last 7 days in Costa Rica time (UTC-6, no DST): local midnight = 06:00Z. */
function ordersWindow() {
  const [year, month, day] = new Date()
    .toLocaleDateString('en-CA', { timeZone: CR_TZ })
    .split('-')
    .map(Number)
  const todayStart = Date.UTC(year, month - 1, day, 6, 0, 0, 0)
  const dayMs = 24 * 60 * 60 * 1000
  return {
    dateFrom: new Date(todayStart - 6 * dayMs).toISOString(),
    dateTo: new Date(todayStart + dayMs - 1).toISOString(),
  }
}

/** Each source fails on its own: 401/403/5xx or a network error just means "no signal". */
async function safeJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function fetchSignals(flags: { isAdmin: boolean; canChats: boolean; canOrders: boolean }): Promise<Signals> {
  const [meta, chats, orders] = await Promise.all([
    flags.isAdmin ? safeJson('/api/chat/meta-status') : Promise.resolve(null),
    flags.canChats ? safeJson('/api/chat/conversations?assigned=none&status=nuevo&limit=50') : Promise.resolve(null),
    flags.canOrders
      ? (() => {
          const { dateFrom, dateTo } = ordersWindow()
          const qs = new URLSearchParams({ limit: '300', page: '1', dateFrom, dateTo })
          return safeJson(`/api/orders?${qs.toString()}`)
        })()
      : Promise.resolve(null),
  ])

  const signals: Signals = { ...EMPTY }
  if (typeof meta?.tenant?.readyToReceive === 'boolean') signals.metaReady = meta.tenant.readyToReceive
  if (Array.isArray(chats?.conversations)) {
    signals.unassigned = { count: chats.conversations.length, more: Boolean(chats.nextCursor) }
  }
  if (Array.isArray(orders?.data)) {
    const sales = orders.data.map(parseOrder).filter((s: unknown): s is NonNullable<ReturnType<typeof parseOrder>> => s !== null)
    signals.sinpePending = sales.filter((o: any) => paymentChip(o).label === 'Pendiente SINPE').length
    signals.porEnviar = sales.filter((o: any) => matchesTab(o, 'por_enviar')).length
  }
  return signals
}

function loadSignals(key: string, flags: Parameters<typeof fetchSignals>[0]): Promise<Signals> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value)
  const running = inflight.get(key)
  if (running) return running
  const promise = fetchSignals(flags)
    .then((value) => {
      cache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

/**
 * Derived alerts for the bell. One cached (60 s) batch of at most three light requests,
 * fetched after mount when the browser is idle. No polling, no new endpoint.
 */
export function useAuroraAlerts(): { alerts: AuroraAlert[]; loading: boolean } {
  const viewer = useAuroraViewer()
  const { summary } = useChannelsSummary()
  const [signals, setSignals] = useState<Signals | null>(null)
  const ready = viewer.role !== null || viewer.isMaster
  const canChats = viewer.can('update_sales')
  const canOrders = viewer.can('view_sales')
  const isAdmin = viewer.isAdmin
  const key = `${isAdmin ? 'a' : 'm'}${canChats ? 'c' : ''}${canOrders ? 'o' : ''}`

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const run = () => {
      loadSignals(key, { isAdmin, canChats, canOrders }).then((value) => {
        if (!cancelled) setSignals(value)
      })
    }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number
      cancelIdleCallback?: (id: number) => void
    }
    const useIdle = typeof w.requestIdleCallback === 'function'
    const handle = useIdle ? w.requestIdleCallback!(run) : window.setTimeout(run, 800)
    return () => {
      cancelled = true
      if (useIdle) w.cancelIdleCallback?.(handle)
      else window.clearTimeout(handle)
    }
  }, [ready, key, isAdmin, canChats, canOrders])

  const alerts = useMemo(
    () =>
      buildAuroraAlerts({
        channelsNeedingAction: summary?.needsAction ?? 0,
        metaReady: signals?.metaReady ?? null,
        unassigned: signals?.unassigned ?? EMPTY.unassigned,
        sinpePending: signals?.sinpePending ?? 0,
        porEnviar: signals?.porEnviar ?? 0,
        isAdmin,
      }),
    [summary?.needsAction, signals, isAdmin],
  )
  return { alerts, loading: signals === null }
}
