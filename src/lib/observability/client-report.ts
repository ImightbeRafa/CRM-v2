'use client'

import { scrubPii } from '@/lib/observability/scrub'

/**
 * Browser errors → POST /api/client-errors (same origin, sendBeacon). At most 5 per page load,
 * duplicates skipped, everything scrubbed before it leaves the browser (scrubbed again on the server).
 */
const MAX_PER_PAGE = 5
let sent = 0
const seen = new Set<string>()
let installed = false

export function reportClientError(error: unknown, extra?: { digest?: string }): void {
  try {
    if (typeof window === 'undefined' || sent >= MAX_PER_PAGE) return
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown')
    const key = `${err.name}|${err.message}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    const payload = JSON.stringify({
      name: scrubPii(err.name).slice(0, 120),
      message: scrubPii(err.message).slice(0, 500),
      stack: err.stack ? scrubPii(err.stack).slice(0, 3000) : undefined,
      route: window.location.pathname.slice(0, 300),
      digest: extra?.digest?.slice(0, 64),
    })
    const blob = new Blob([payload], { type: 'application/json' })
    if (!navigator.sendBeacon?.('/api/client-errors', blob)) {
      void fetch('/api/client-errors', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'same-origin' }).catch(() => undefined)
    }
  } catch {
    /* reporting must never break the page */
  }
}

/** Uncaught errors and unhandled promise rejections anywhere in the app. */
export function installClientErrorListeners(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => {
    // Ignore cross-origin script noise ("Script error.") and browser extensions.
    if (!event.error && /^Script error\.?$/.test(event.message || '')) return
    if (event.filename && !event.filename.startsWith(window.location.origin)) return
    reportClientError(event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError(event.reason)
  })
}
