'use client'

import { useEffect, useRef, useState } from 'react'
import { AlarmClock, Loader2 } from 'lucide-react'
import { snoozePresets } from '@/lib/chat-work-state'

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-CR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** `YYYY-MM-DDTHH:mm` in local time for <input type="datetime-local">. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * "Posponer": hides the chat from the open lists until a time; it comes back by itself then, or
 * as soon as the customer writes. When snoozed, the button shows until when and can wake it now.
 */
export function ChatSnoozeButton({
  snoozedUntil,
  onSnooze,
  onWake,
}: {
  snoozedUntil: string | null
  onSnooze: (untilIso: string) => Promise<boolean>
  onWake: () => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  const ref = useRef<HTMLDivElement>(null)

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

  async function run(fn: () => Promise<boolean>) {
    setBusy(true)
    try {
      if (await fn()) setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const snoozed = Boolean(snoozedUntil && new Date(snoozedUntil).getTime() > Date.now())

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setCustom(localInputValue(new Date(Date.now() + 24 * 60 * 60_000)))
          setOpen((v) => !v)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={snoozed ? `Pospuesto hasta ${fmt(snoozedUntil!)}` : 'Posponer este chat'}
        className={`inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 transition-colors ${
          snoozed ? 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
        }`}
        data-testid="chat-snooze-button"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <AlarmClock className="h-3.5 w-3.5" aria-hidden />}
        <span className="hidden lg:inline">{snoozed ? `Hasta ${fmt(snoozedUntil!)}` : 'Posponer'}</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-[230px] rounded-xl bg-white p-1.5 text-[12.5px] shadow-xl ring-1 ring-slate-200">
          {snoozed ? (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void run(onWake)}
              className="mb-1 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left font-semibold text-amber-800 hover:bg-amber-50"
            >
              Despertar ahora
            </button>
          ) : null}
          <p className="px-2.5 pb-1 pt-0.5 text-[10.5px] text-slate-400">Vuelve solo a esa hora o si el cliente escribe.</p>
          {snoozePresets().map((p) => (
            <button
              key={p.key}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void run(() => onSnooze(p.until.toISOString()))}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-50"
            >
              <span>{p.label}</span>
              <span className="text-[10.5px] text-slate-400">{fmt(p.until.toISOString())}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-slate-100 px-2.5 pt-2">
            <label className="block text-[10.5px] text-slate-500" htmlFor="snooze-custom">
              Otra fecha y hora
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                id="snooze-custom"
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="min-w-0 flex-1 rounded-md bg-slate-50 px-1.5 py-1 text-[11.5px] ring-1 ring-slate-200"
              />
              <button
                type="button"
                disabled={busy || !custom}
                onClick={() => {
                  const d = new Date(custom)
                  if (!Number.isNaN(d.getTime())) void run(() => onSnooze(d.toISOString()))
                }}
                className="rounded-md bg-au-ink-5b6cff px-2 py-1 text-[11px] font-semibold text-static-white disabled:opacity-40"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
