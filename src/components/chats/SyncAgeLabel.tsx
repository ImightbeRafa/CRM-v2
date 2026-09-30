'use client'

import { useEffect, useState } from 'react'

/**
 * "Sincronizado hace Ns". Ticks by itself so the big inbox does not re-render every second
 * (perf review 2026-09-30), and pauses while the tab is hidden.
 */
export function SyncAgeLabel({ lastSyncAt }: { lastSyncAt: number | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!lastSyncAt) return
    setNow(Date.now())
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(id)
  }, [lastSyncAt])
  if (!lastSyncAt) return null
  const seconds = Math.max(0, Math.floor((now - lastSyncAt) / 1000))
  return <p className="mt-0.5 text-[10px] text-slate-400">Sincronizado hace {seconds}s</p>
}
