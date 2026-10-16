/**
 * Agentes IA 2.0 · notify — pure helpers for the bell's "money waiting" alerts (no React, no DOM).
 *
 * - Polling: every 15 s while the tab is visible; when hidden only if the person allowed browser
 *   notifications (60 s, so the native alert can still fire), otherwise not at all.
 * - New-alert detection: an unread payment_review / order_review the bell has not seen before. On the
 *   first load of the page only alerts younger than 2 minutes chime (old ones just show in the count).
 * - Tab title: "(N) " prefix while N such alerts are unread.
 */

export const REVIEW_ALERT_KINDS = ['payment_review', 'order_review'] as const
export type ReviewAlertKind = (typeof REVIEW_ALERT_KINDS)[number]

export const POLL_VISIBLE_MS = 15_000
export const POLL_HIDDEN_MS = 60_000
/** On first load, alerts newer than this still chime / toast (the person just opened the app). */
export const FIRST_LOAD_FRESH_MS = 2 * 60_000

export type AlertItem = { id: string; kind: string; read: boolean; createdAt: string; title: string; snippet: string | null; href: string }

export function isReviewAlertKind(kind: string | null | undefined): kind is ReviewAlertKind {
  return kind === 'payment_review' || kind === 'order_review'
}

/** Milliseconds until the next poll, or null = do not poll. */
export function notificationPollMs(opts: { visible: boolean; browserNotifyGranted: boolean }): number | null {
  if (opts.visible) return POLL_VISIBLE_MS
  return opts.browserNotifyGranted ? POLL_HIDDEN_MS : null
}

/**
 * Which unread review alerts are new since the last poll. `seen` null = first load of the page.
 * Returns the alerts to announce (newest first) and the updated seen set (all review ids in `items`
 * plus the ones seen before, so a re-sorted list never re-announces).
 */
export function detectNewReviewAlerts(
  seen: ReadonlySet<string> | null,
  items: AlertItem[],
  nowMs: number = Date.now(),
): { alerts: AlertItem[]; seen: Set<string> } {
  const next = new Set(seen ?? [])
  const alerts: AlertItem[] = []
  for (const it of items) {
    if (!isReviewAlertKind(it.kind)) continue
    const known = next.has(it.id)
    next.add(it.id)
    if (known || it.read) continue
    if (seen === null) {
      const at = Date.parse(it.createdAt)
      if (!Number.isFinite(at) || nowMs - at > FIRST_LOAD_FRESH_MS) continue
    }
    alerts.push(it)
  }
  alerts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return { alerts, seen: next }
}

export function unreadReviewCount(items: AlertItem[]): number {
  return items.filter((it) => !it.read && isReviewAlertKind(it.kind)).length
}

const TITLE_PREFIX_RE = /^\(\d+\+?\)\s/

/** "(2) Betsy" while 2 alerts are unread; the plain title when none. Never stacks prefixes. */
export function titleWithCount(title: string, count: number): string {
  const base = String(title || '').replace(TITLE_PREFIX_RE, '')
  if (count <= 0) return base
  return `(${count > 99 ? '99+' : count}) ${base}`
}
