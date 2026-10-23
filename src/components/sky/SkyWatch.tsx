'use client'

import { useEffect, useRef } from 'react'

/**
 * Runs its parent sky (data-run) only while it is on screen and the tab is visible, and never before the page has
 * loaded and gone idle (the sky is decoration: it must not compete with the first paint). Renders nothing visible.
 */
export function SkyWatch() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const sky = ref.current?.parentElement
    if (!sky) return
    let onScreen = false
    let ready = false
    // Idle-callback ids and timer ids are separate pools: remember which one we hold.
    let pending: { kind: 'idle' | 'timer'; id: number } | null = null
    const sync = () => {
      if (ready && onScreen && !document.hidden) sky.setAttribute('data-run', '')
      else sky.removeAttribute('data-run')
    }
    const start = () => {
      const go = () => {
        pending = null
        ready = true
        sync()
      }
      pending =
        typeof window.requestIdleCallback === 'function'
          ? { kind: 'idle', id: window.requestIdleCallback(go, { timeout: 2500 }) }
          : { kind: 'timer', id: window.setTimeout(go, 1200) }
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            // the newest entry wins when several crossings arrive in one batch (fast fling, anchor jump)
            const last = entries[entries.length - 1]
            if (last) onScreen = last.isIntersecting
            sync()
          })
    if (io) io.observe(sky)
    else onScreen = true
    document.addEventListener('visibilitychange', sync)
    return () => {
      io?.disconnect()
      window.removeEventListener('load', start)
      if (pending?.kind === 'idle') window.cancelIdleCallback(pending.id)
      else if (pending?.kind === 'timer') window.clearTimeout(pending.id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return <span ref={ref} hidden />
}
