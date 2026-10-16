'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AFTER_HOURS_NOTE_MAX,
  BUSINESS_HOURS_TIMEZONE,
  isWithinBusinessHours,
  nextOpening,
  parseBusinessHours,
  starterBusinessHours,
  type BusinessHours,
} from '@/lib/soft-ai/business-hours'

/** Lun–Dom (JS weekday numbers: 0 = domingo). */
const ROWS: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Lun' },
  { day: 2, label: 'Mar' },
  { day: 3, label: 'Mié' },
  { day: 4, label: 'Jue' },
  { day: 5, label: 'Vie' },
  { day: 6, label: 'Sáb' },
  { day: 0, label: 'Dom' },
]

const FIELD = 'rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[12px] text-slate-800 disabled:opacity-60'

/**
 * "Horario de atención" per agent (agents2-hours). Off = 24/7 (default). One window per day here; a schedule saved
 * with more windows keeps them for the days not edited.
 */
export function AgentBusinessHoursCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [hours, setHours] = useState<BusinessHours | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, { cache: 'no-store' }).catch(() => null)
      if (!res?.ok) return
      const json = (await res.json().catch(() => ({}))) as { businessHours?: unknown }
      if (!cancelled) setHours(parseBusinessHours(json.businessHours))
    })()
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [agentId])

  const preview = useMemo(() => {
    if (!hours?.enabled) return null
    if (isWithinBusinessHours(hours, now)) return 'Ahora: dentro de horario.'
    const next = nextOpening(hours, now)
    return `Ahora: fuera de horario${next ? ` (abre ${next.label})` : ''}.`
  }, [hours, now])

  async function save(next: BusinessHours) {
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessHours: next }),
    }).catch(() => null)
    const json = (await res?.json().catch(() => ({}))) as { businessHours?: unknown; error?: string } | undefined
    if (res?.ok) {
      setHours(parseBusinessHours(json?.businessHours))
      setMsg({ ok: true, text: 'Guardado.' })
    } else setMsg({ ok: false, text: json?.error || 'No se pudo guardar.' })
    setBusy(false)
  }

  if (!hours) return null
  const windowOf = (day: number) => hours.windows.find((w) => w.day === day) ?? null
  const setDay = (day: number, patch: { open?: string; close?: string } | null) => {
    const others = hours.windows.filter((w) => w.day !== day)
    const current = windowOf(day) ?? { day, open: '08:00', close: '18:00' }
    const extra = hours.windows.filter((w) => w.day === day).slice(1)
    const windows = patch === null ? others : [...others, { ...current, ...patch }, ...extra]
    setHours({ ...hours, windows: windows.sort((a, b) => a.day - b.day || a.open.localeCompare(b.open)) })
  }

  return (
    <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70" data-testid="agent-business-hours">
      <label className="flex items-center gap-2 text-[12px] font-medium text-slate-700">
        <input
          type="checkbox"
          checked={hours.enabled}
          disabled={!canEdit || busy}
          onChange={(e) => {
            const enabled = e.target.checked
            const next = enabled && !hours.windows.length ? starterBusinessHours() : { ...hours, enabled }
            void save({ ...next, afterHoursNote: hours.afterHoursNote ?? null })
          }}
        />
        Usar horario de atención
      </label>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {hours.enabled
          ? 'Fuera de horario la IA sigue vendiendo y respondiendo; si piden a alguien del equipo, avisa cuándo los atienden. Hora de Costa Rica.'
          : 'Apagado: la IA atiende igual las 24 horas.'}
      </p>
      {hours.enabled ? (
        <div className="mt-2 space-y-1">
          {ROWS.map((row) => {
            const w = windowOf(row.day)
            return (
              <div key={row.day} className="flex flex-wrap items-center gap-2 text-[12px] text-slate-700">
                <span className="w-9">{row.label}</span>
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={Boolean(w)} disabled={!canEdit || busy} onChange={(e) => setDay(row.day, e.target.checked ? {} : null)} />
                  {w ? 'Abierto' : 'Cerrado'}
                </label>
                {w ? (
                  <>
                    <span>desde</span>
                    <input type="time" className={FIELD} value={w.open} disabled={!canEdit || busy} onChange={(e) => setDay(row.day, { open: e.target.value })} />
                    <span>hasta</span>
                    <input type="time" className={FIELD} value={w.close === '24:00' ? '00:00' : w.close} disabled={!canEdit || busy} onChange={(e) => setDay(row.day, { close: e.target.value })} />
                  </>
                ) : null}
              </div>
            )
          })}
          <label className="mt-1 flex flex-col gap-1 text-[12px] text-slate-700">
            Nota fuera de horario (opcional)
            <input
              className={FIELD}
              maxLength={AFTER_HOURS_NOTE_MAX}
              value={hours.afterHoursNote ?? ''}
              disabled={!canEdit || busy}
              placeholder="Ej. Para urgencias escribinos por Instagram."
              onChange={(e) => setHours({ ...hours, afterHoursNote: e.target.value })}
            />
          </label>
          {preview ? <p className="text-[11px] text-slate-600" data-testid="business-hours-now">{preview}</p> : null}
          {!hours.windows.length ? (
            <p className="text-[11px] text-red-700" data-testid="business-hours-empty">Abrí al menos un día para guardar el horario.</p>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              disabled={busy || !hours.windows.length}
              onClick={() => void save({ ...hours, timezone: BUSINESS_HOURS_TIMEZONE, afterHoursNote: hours.afterHoursNote?.trim() || null })}
              className="mt-1 rounded-full bg-[#5B6CFF] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-60"
            >
              Guardar horario
            </button>
          ) : null}
        </div>
      ) : null}
      {msg ? <p className={`mt-1 text-[11px] ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p> : null}
    </div>
  )
}
