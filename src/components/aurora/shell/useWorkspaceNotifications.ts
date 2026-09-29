'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuroraViewer } from './useAuroraViewer'

export type WorkspaceNotificationItem = {
  id: string
  kind: 'mention' | 'task_assigned' | 'task_due' | 'chat_assigned'
  read: boolean
  createdAt: string
  title: string
  snippet: string | null
  href: string
}

const POLL_MS = 60_000

/**
 * My @mentions / assigned tasks for the bell. Polls once a minute while the tab is visible and
 * whenever `refresh()` is called (bell opened). Silent on errors; empty before migration 036.
 */
export function useWorkspaceNotifications() {
  const viewer = useAuroraViewer()
  const enabled = viewer.can('update_sales')
  const [items, setItems] = useState<WorkspaceNotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [overdueTasks, setOverdueTasks] = useState(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch('/api/workspace/notifications', { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; unread?: number; overdueTasks?: number; items?: WorkspaceNotificationItem[] } | null
      if (!res.ok || !json?.success) return
      setItems(Array.isArray(json.items) ? json.items : [])
      setUnread(typeof json.unread === 'number' ? json.unread : 0)
      setOverdueTasks(typeof json.overdueTasks === 'number' ? json.overdueTasks : 0)
    } catch {
      /* the bell keeps its derived alerts */
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, refresh])

  const markRead = useCallback(async (ids?: string[]) => {
    setItems((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)))
    setUnread((u) => (ids ? Math.max(0, u - ids.length) : 0))
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

  return { enabled, items, unread, overdueTasks, refresh, markRead }
}
