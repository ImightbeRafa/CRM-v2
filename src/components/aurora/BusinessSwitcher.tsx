'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { clearBusinessScopedBrowserState } from '@/lib/business-switch-client'

type Business = { id: string; name: string; role: string; current: boolean }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'B'
}

/**
 * Sidebar business header (Phase 2b). With one business it is a static label; with several it
 * opens a list to switch. Switching: server checks the membership and stores the default, the
 * session re-syncs from the DB, business-scoped browser state is cleared, and the app reloads.
 */
export function BusinessSwitcher({ tenantName, collapsed }: { tenantName: string; collapsed: boolean }) {
  const { update } = useSession()
  const [businesses, setBusinesses] = useState<Business[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/tenant/memberships', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json().catch(() => null))
      .then((json) => {
        if (alive && json?.success && Array.isArray(json.businesses)) setBusinesses(json.businesses)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Any OTHER business to go to (also when the current one was deactivated and is not listed).
  const canSwitch = Boolean(businesses?.some((b) => !b.current))

  async function switchTo(b: Business) {
    if (b.current || busy) return
    setBusy(b.id)
    setError(null)
    try {
      const res = await fetch('/api/tenant/switch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: b.id }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setError(json?.error || 'No se pudo cambiar de negocio.')
        setBusy(null)
        return
      }
      // Forces the session to re-read the active business from the DB (no payload is trusted),
      // and only navigates when the session really moved (L1).
      let next = await update()
      if ((next?.user as { tenantId?: string } | undefined)?.tenantId !== b.id) {
        // The session re-sync is throttled to once every 2 s: retry once after that window.
        await new Promise((r) => setTimeout(r, 2200))
        next = await update()
      }
      if ((next?.user as { tenantId?: string } | undefined)?.tenantId !== b.id) {
        setError('No se pudo cambiar de negocio. Recargá la página e intentá de nuevo.')
        setBusy(null)
        return
      }
      clearBusinessScopedBrowserState()
      // `busy` stays set while navigating, so a second switch cannot start.
      window.location.assign('/dashboard')
    } catch {
      setError('Sin conexión.')
      setBusy(null)
    }
  }

  const header = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[11px] font-bold">
        {initials(tenantName)}
      </span>
      {collapsed ? null : (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold leading-tight">{tenantName}</span>
          {canSwitch ? <span className="block text-[10.5px] text-static-white/50">{businesses!.length} negocios</span> : null}
        </span>
      )}
      {canSwitch && !collapsed ? <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-static-white/50" aria-hidden /> : null}
    </>
  )

  const boxClass = `mb-5 flex items-center rounded-xl border border-static-white/10 bg-static-white/[0.04] motion-safe:transition-colors motion-safe:duration-200 hover:bg-static-white/[0.07] ${
    collapsed ? 'mx-auto h-11 w-11 justify-center' : 'mx-3 gap-2.5 px-2.5 py-2'
  }`

  if (!canSwitch) {
    return (
      <div className={boxClass} title={collapsed ? tenantName : undefined}>
        {header}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? `${tenantName} · cambiar de negocio` : undefined}
        className={`${boxClass} ${collapsed ? '' : 'w-[calc(100%-1.5rem)]'}`}
        data-testid="business-switcher"
      >
        {header}
      </button>
      {open ? (
        <div role="menu" className={`absolute z-50 rounded-xl bg-white p-1.5 text-slate-900 shadow-2xl ring-1 ring-slate-200 ${collapsed ? 'left-14 top-0 w-64' : 'left-3 right-3 top-full -mt-3'}`}>
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Tus negocios</p>
          {businesses!.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitemradio"
              aria-checked={b.current}
              disabled={Boolean(busy)}
              onClick={() => void switchTo(b)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${b.current ? 'bg-au-tint-eef0ff' : 'hover:bg-slate-50'}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[10px] font-bold text-white">
                {initials(b.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{b.name}</span>
                <span className="block text-[11px] text-slate-500">{b.role}</span>
              </span>
              {busy === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden /> : b.current ? <Check className="h-3.5 w-3.5 text-au-ink-5b6cff" aria-hidden /> : null}
            </button>
          ))}
          {error ? <p role="alert" className="px-2.5 py-1.5 text-[11.5px] text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
