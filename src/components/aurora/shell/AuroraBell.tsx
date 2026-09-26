'use client'

import { useCallback, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { showBellDot } from '@/lib/aurora-alerts'
import { AuroraAlertsList } from './AuroraAlertsList'
import { useAuroraAlerts } from './useAuroraAlerts'
import { useDismiss } from './useDismiss'

/**
 * Notifications bell. Alerts are derived from existing signals (no table, no read state);
 * the red dot shows only when there is at least one. Popover on desktop, bottom sheet below `md`.
 */
export function AuroraBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { alerts } = useAuroraAlerts()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const dot = showBellDot(alerts)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={dot ? `Avisos (${alerts.length})` : 'Avisos'}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {dot ? (
          <span
            data-testid="aurora-bell-dot"
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"
          />
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" aria-hidden />
          <div
            role="dialog"
            aria-label="Avisos"
            className="aurora-light fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-3xl border border-slate-200/70 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] text-slate-900 shadow-xl md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-11 md:max-h-[60vh] md:w-[340px] md:rounded-2xl md:pb-0"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-[14px] font-semibold">Avisos</h2>
              {dot ? <span className="text-[11px] text-slate-400">{alerts.length}</span> : null}
            </div>
            <AuroraAlertsList alerts={alerts} onNavigate={close} />
          </div>
        </>
      ) : null}
    </div>
  )
}
