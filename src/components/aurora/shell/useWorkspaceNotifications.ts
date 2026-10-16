'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuroraViewer } from './useAuroraViewer'
import { detectNewReviewAlerts, notificationPollMs, unreadReviewCount } from '@/lib/notification-alerts'

export type WorkspaceNotificationItem = {
  id: string
  kind:
    | 'mention'
    | 'task_assigned'
    | 'task_due'
    | 'chat_assigned'
    | 'ai_no_reply'
    | 'ai_budget'
    | 'payment_review'
    | 'order_review'
  read: boolean
  createdAt: string
  title: string
  snippet: string | null
  href: string
}

type Snapshot = { items: WorkspaceNotificationItem[]; unread: number; overdueTasks: number }

/**
 * One shared poller for every mounted bell (desktop + mobile headers mount two): 15 s while the tab is
 * visible, 60 s when hidden only if browser notifications are allowed, otherwise paused while hidden.
 * New unread payment_review / order_review alerts are queued once; the first bell to `claimNewAlerts()`
 * announces them (chime, toast, browser notification), so two bells never double-announce.
 */
let snapshot: Snapshot = { items: [], unread: 0, overdueTasks: 0 }
const listeners = new Set<(s: Snapshot) => void>()
let seen: Set<string> | null = null
let pending: WorkspaceNotificationItem[] = []
let timer: number | null = null
let inflight: Promise<void> | null = null
let visibilityInstalled = false

function emit() {
  for (const l of listeners) l(snapshot)
}

function browserNotifyGranted(): boolean {
  try {
    return typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted'
  } catch {
    return false
  }
}

function fetchNow(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/workspace/notifications', { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; unread?: number; overdueTasks?: number; items?: WorkspaceNotificationItem[] } | null
      if (!res.ok || !json?.success) return
      const items = Array.isArray(json.items) ? json.items : []
      const found = detectNewReviewAlerts(seen, items)
      seen = found.seen
      if (found.alerts.length) pending = [...(found.alerts as WorkspaceNotificationItem[]), ...pending].slice(0, 10)
      snapshot = {
        items,
        unread: typeof json.unread === 'number' ? json.unread : 0,
        overdueTasks: typeof json.overdueTasks === 'number' ? json.overdueTasks : 0,
      }
      emit()
    } catch {
      /* the bell keeps its derived alerts */
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function schedule() {
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  if (!listeners.size) return
  const ms = notificationPollMs({ visible: document.visibilityState === 'visible', browserNotifyGranted: browserNotifyGranted() })
  if (ms === null) return
  timer = window.setTimeout(() => {
    void fetchNow().finally(schedule)
  }, ms)
}

function installVisibility() {
  if (visibilityInstalled) return
  visibilityInstalled = true
  document.addEventListener('visibilitychange', () => {
    if (!listeners.size) return
    // Back on the tab: catch up at once, then the visible cadence.
    if (document.visibilityState === 'visible') void fetchNow().finally(schedule)
    else schedule()
  })
}

/** Alerts not announced yet (each one is handed out once, to the first caller). */
export function claimNewAlerts(): WorkspaceNotificationItem[] {
  const out = pending
  pending = []
  return out
}

/**
 * My @mentions / assigned tasks / AI alerts for the bell. Silent on errors; empty before migration 036.
 */
export function useWorkspaceNotifications() {
  const viewer = useAuroraViewer()
  const enabled = viewer.can('update_sales')
  const [snap, setSnap] = useState<Snapshot>(snapshot)

  const refresh = useCallback(async () => {
    if (!enabled) return
    await fetchNow()
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    installVisibility()
    const first = listeners.size === 0
    listeners.add(setSnap)
    setSnap(snapshot)
    if (first) void fetchNow().finally(schedule)
    return () => {
      listeners.delete(setSnap)
      if (!listeners.size && timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
  }, [enabled])

  const markRead = useCallback(async (ids?: string[]) => {
    snapshot = {
      ...snapshot,
      items: snapshot.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)),
      unread: ids ? Math.max(0, snapshot.unread - snapshot.items.filter((n) => ids.includes(n.id) && !n.read).length) : 0,
    }
    emit()
    try {
      await fetch('/api/workspace/notifications', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      })
    } catch {
      /* next refresh corrects the count */
    }
  }, [])

  return {
    enabled,
    items: snap.items,
    unread: snap.unread,
    overdueTasks: snap.overdueTasks,
    /** Unread "Verificá un pago" / "Pedido por confirmar" alerts (bell badge + tab title). */
    reviewUnread: unreadReviewCount(snap.items),
    refresh,
    markRead,
    claimNewAlerts,
  }
}
