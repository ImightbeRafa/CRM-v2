'use client'

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

/**
 * Shows the server-rendered poster (same size as the player, so nothing jumps) and imports the player only when
 * the poster gets within 200px of the screen. Keeps demo code out of the first load.
 */
const PLAYERS = {
  story: () => import('./StoryPlayer'),
  agent: () => import('./AgentPlayer'),
} as const

export function LazyDemo({ which, children }: { which: keyof typeof PLAYERS; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [Player, setPlayer] = useState<ComponentType | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const load = () =>
      PLAYERS[which]()
        .then((m) => {
          if (!cancelled) setPlayer(() => m.default)
        })
        .catch(() => undefined) // keep the poster
    if (typeof IntersectionObserver === 'undefined') {
      void load()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          void load()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [which])

  return <div ref={ref}>{Player ? <Player /> : children}</div>
}
