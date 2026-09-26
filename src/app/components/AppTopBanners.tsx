'use client'

import { useEffect, useRef } from 'react'
import SubscriptionBanner from './SubscriptionBanner'
import { PreviewDataWarning } from './PreviewDataWarning'

/**
 * Global banners (billing / preview warning). Publishes their height as `--app-top-offset`
 * so full-height shells (AuroraShell) can subtract it and keep the mobile bottom nav on screen.
 */
export function AppTopBanners({ showPreviewWarning }: { showPreviewWarning: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty('--app-top-offset', `${Math.round(el.getBoundingClientRect().height)}px`)
    publish()
    if (typeof ResizeObserver === 'undefined') return () => root.style.setProperty('--app-top-offset', '0px')
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.setProperty('--app-top-offset', '0px')
    }
  }, [])

  return (
    <div ref={ref} className="sticky top-0 z-50" data-testid="app-top-banners">
      <SubscriptionBanner />
      {showPreviewWarning ? <PreviewDataWarning /> : null}
    </div>
  )
}
