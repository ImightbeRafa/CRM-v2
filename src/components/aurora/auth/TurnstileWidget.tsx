'use client'

import { useEffect, useRef, useState } from 'react'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scriptPromise = null
        reject(new Error('turnstile_script'))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

/**
 * Cloudflare Turnstile, rendered only when the server has it configured (the site key is fetched
 * at runtime, see src/lib/turnstile.ts). Reports the token through onToken; null = none/expired.
 * Changing `resetKey` asks for a fresh challenge (tokens are single-use).
 */
export function TurnstileWidget({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    let alive = true
    fetch('/api/auth/turnstile-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { siteKey?: string | null }) => {
        if (alive) setSiteKey(d.siteKey || null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!siteKey || !el) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile) return
        widgetId.current = window.turnstile.render(el, {
          sitekey: siteKey,
          callback: (t: string) => onTokenRef.current(t),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => onTokenRef.current(null))
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current)
      onTokenRef.current(null)
    }
  }, [resetKey])

  if (!siteKey) return null
  return <div ref={ref} className="flex justify-center" data-testid="turnstile" />
}
