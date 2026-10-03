'use client'

import { useEffect, useState } from 'react'

// One read per page load (shared by every thread pane); null = unknown (no permission or network error).
let cached: Promise<boolean | null> | null = null

function load(): Promise<boolean | null> {
  cached ??= fetch('/api/chat/agents/ai-terms', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((json: { accepted?: unknown } | null) => (typeof json?.accepted === 'boolean' ? json.accepted : null))
    .catch(() => null)
  return cached
}

/** Whether the business authorized AI features (agents stay silent until it does). */
export function useAiTermsAccepted(enabled: boolean): boolean | null {
  const [accepted, setAccepted] = useState<boolean | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void load().then((value) => {
      if (alive) setAccepted(value)
    })
    return () => {
      alive = false
    }
  }, [enabled])
  return accepted
}
