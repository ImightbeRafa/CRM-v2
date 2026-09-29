'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { AtSign, Bell, ListChecks } from 'lucide-react'
import { showBellDot } from '@/lib/aurora-alerts'
import { AuroraAlertsList } from './AuroraAlertsList'
import { useAuroraAlerts } from './useAuroraAlerts'
import { useDismiss } from './useDismiss'
import { useWorkspaceNotifications } from './useWorkspaceNotifications'

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const h = Math.round(mins / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/**
 * Notifications bell. Two sources:
 * - personal notifications (Phase 2b): @mentions and tasks assigned to me, with read state;
 * - derived alerts from existing signals (no table, no read state).
 * The red dot shows when there is an alert or an unread notification. Popover on desktop,
 * bottom sheet below `md`.
 */
export function AuroraBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { alerts } = useAuroraAlerts()
  const notes = useWorkspaceNotifications()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)
  const dot = showBellDot(alerts) || notes.unread > 0 || notes.overdueTasks > 0
  const total = alerts.length + notes.unread + (notes.overdueTasks > 0 ? 1 : 0)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) void notes.refresh()
          setOpen((v) => !v)
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={dot ? `Avisos (${total})` : 'Avisos'}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors duration-150 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#8F7BFF]/60 focus-visible:ring-offset-2"
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
            className="aurora-light fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-3xl border border-slate-200/70 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] text-slate-900 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-11 md:max-h-[60vh] md:w-[340px] md:rounded-xl md:pb-0"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-[14px] font-semibold">Avisos</h2>
              {notes.unread > 0 ? (
                <button type="button" onClick={() => void notes.markRead()} className="text-[11px] font-medium text-[#5B6CFF] hover:underline">
                  Marcar todo leído
                </button>
              ) : dot ? (
                <span className="text-[11px] text-slate-400">{total}</span>
              ) : null}
            </div>
            {notes.overdueTasks > 0 ? (
              <Link
                href="/tareas"
                onClick={close}
                className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-red-700 outline-none hover:bg-red-50 focus-visible:bg-red-50"
                data-testid="aurora-overdue-tasks"
              >
                <ListChecks className="h-4 w-4 shrink-0" aria-hidden />
                {notes.overdueTasks === 1 ? '1 tarea vencida' : `${notes.overdueTasks} tareas vencidas`}
              </Link>
            ) : null}
            {notes.items.length ? (
              <ul className="divide-y divide-slate-100 border-b border-slate-100" data-testid="aurora-notifications">
                {notes.items.slice(0, 15).map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => {
                        if (!n.read) void notes.markRead([n.id])
                        close()
                      }}
                      className={`flex gap-3 px-4 py-2.5 text-[13px] outline-none transition-colors duration-150 hover:bg-slate-50 focus-visible:bg-slate-50 ${n.read ? 'text-slate-500' : 'text-slate-900'}`}
                    >
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${n.read ? 'bg-slate-100 text-slate-400' : 'bg-[#EEF0FF] text-[#5B6CFF]'}`}
                        aria-hidden
                      >
                        {n.kind === 'mention' ? <AtSign className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                        {n.snippet ? <span className="block truncate text-[12px] text-slate-500">{n.snippet}</span> : null}
                        <span className="block text-[11px] text-slate-400">{ago(n.createdAt)}</span>
                      </span>
                      {!n.read ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#5B6CFF]" aria-label="Sin leer" /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {alerts.length || !notes.items.length ? <AuroraAlertsList alerts={alerts} onNavigate={close} /> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
