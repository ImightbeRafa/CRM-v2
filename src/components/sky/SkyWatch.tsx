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
    let idle: number | undefined
    const sync = () => {
      if (ready && onScreen && !document.hidden) sky.setAttribute('data-run', '')
      else sky.removeAttribute('data-run')
    }
    const start = () => {
      const go = () => {
        ready = true
        sync()
      }
      idle =
        typeof window.requestIdleCallback === 'function'
          ? window.requestIdleCallback(go, { timeout: 2500 })
          : window.setTimeout(go, 1200)
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([e]) => {
            onScreen = e.isIntersecting
            sync()
          })
    if (io) io.observe(sky)
    else onScreen = true
    document.addEventListener('visibilitychange', sync)
    return () => {
      io?.disconnect()
      window.removeEventListener('load', start)
      if (idle !== undefined) {
        if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle)
        window.clearTimeout(idle)
      }
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return <span ref={ref} hidden />
}
