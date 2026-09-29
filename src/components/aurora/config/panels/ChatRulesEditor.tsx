'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ConfigCard } from '@/components/aurora/config/panels/ConfigCard'
import { useCrmCatalog } from '@/components/chats/useCrmCatalog'
import { isClosedCategory } from '@/lib/crm-stages'
import type { AssignmentMode, BusinessHours, Weekday } from '@/lib/chat-assignment-rules'

type Settings = {
  assignmentMode: AssignmentMode
  assigneeUserIds: string[]
  skipAiActive: boolean
  businessHours: BusinessHours
  timezone: string
  autoCloseDays: number | null
  autoCloseStageKey: string | null
  reopenOnInbound: boolean
}
type Teammate = { id: string; name: string }

const DAYS: Array<[Weekday, string]> = [
  ['mon', 'Lunes'],
  ['tue', 'Martes'],
  ['wed', 'Miércoles'],
  ['thu', 'Jueves'],
  ['fri', 'Viernes'],
  ['sat', 'Sábado'],
  ['sun', 'Domingo'],
]
const DEFAULT_HOURS: BusinessHours = {
  mon: [['08:00', '17:00']],
  tue: [['08:00', '17:00']],
  wed: [['08:00', '17:00']],
  thu: [['08:00', '17:00']],
  fri: [['08:00', '17:00']],
  sat: [['09:00', '13:00']],
}

function Toggle({ checked, onChange, label, testid }: { checked: boolean; onChange: (v: boolean) => void; label: string; testid?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[#5B6CFF]" data-testid={testid} />
      {label}
    </label>
  )
}

/**
 * Config › Chats (Phase 2b): automatic assignment, business hours and auto-close. Everything is
 * off until an owner / admin turns it on; turning assignment on only affects chats whose customer
 * writes from then on (never the backlog).
 */
export function ChatRulesEditor() {
  const { chatStages } = useCrmCatalog()
  const closedStages = useMemo(() => chatStages.filter((s) => !s.archived && isClosedCategory(s.category)), [chatStages])
  const [s, setS] = useState<Settings | null>(null)
  const [available, setAvailable] = useState(true)
  const [team, setTeam] = useState<Teammate[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [cfg, people] = await Promise.all([
          fetch('/api/config/chat-workspace', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json().catch(() => null)),
          fetch('/api/chat/assignees', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json().catch(() => null)),
        ])
        if (!alive) return
        if (cfg?.success) {
          setAvailable(cfg.available !== false)
          setS(cfg.settings as Settings)
        } else {
          setAvailable(false)
        }
        setTeam(Array.isArray(people?.assignees) ? people.assignees : [])
      } catch {
        if (alive) setAvailable(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const set = (patch: Partial<Settings>) => setS((prev) => (prev ? { ...prev, ...patch } : prev))
  const hoursOn = Boolean(s && Object.keys(s.businessHours || {}).length)

  async function save() {
    if (!s) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/config/chat-workspace', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string; settings?: Settings } | null
      if (!res.ok || !json?.success || !json.settings) {
        setMessage({ tone: 'error', text: json?.error || 'No se pudo guardar.' })
        return
      }
      setS(json.settings)
      setMessage({ tone: 'ok', text: 'Guardado' })
    } catch {
      setMessage({ tone: 'error', text: 'Sin conexión.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfigCard className="p-5" data-testid="chats-config-rules">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Reparto, horario y cierre automático</h2>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          Todo está apagado hasta que lo actives. Sin reglas, el chat queda de la primera persona que responde.
        </p>
      </div>
      {!available ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">Estas reglas se activan con la próxima actualización.</p>
      ) : s === null ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-slate-800">Asignar chats nuevos automáticamente</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Modo de asignación">
              {(
                [
                  ['off', 'Apagado'],
                  ['round_robin', 'Por turnos'],
                  ['workload', 'A quien tenga menos chats'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={s.assignmentMode === key}
                  onClick={() => set({ assignmentMode: key })}
                  className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium ring-1 ${s.assignmentMode === key ? 'bg-au-tint-eef0ff text-au-ink-4a46e5 ring-[#5B6CFF]/30' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {s.assignmentMode !== 'off' ? (
              <div className="mt-2.5 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <p className="text-[11.5px] text-slate-500">Reparte entre:</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {team.map((t) => (
                    <Toggle
                      key={t.id}
                      checked={s.assigneeUserIds.includes(t.id)}
                      onChange={(v) => set({ assigneeUserIds: v ? [...s.assigneeUserIds, t.id] : s.assigneeUserIds.filter((x) => x !== t.id) })}
                      label={t.name}
                    />
                  ))}
                </div>
                <Toggle checked={s.skipAiActive} onChange={(v) => set({ skipAiActive: v })} label="No asignar chats que está atendiendo la IA" />
                <p className="text-[11px] text-slate-400">Solo chats donde el cliente escriba desde que lo actives; nunca le quita un chat a nadie.</p>
              </div>
            ) : null}
          </section>

          <section>
            <Toggle
              checked={hoursOn}
              onChange={(v) => set({ businessHours: v ? DEFAULT_HOURS : {} })}
              label="Asignar solo en horario de atención (hora de Costa Rica)"
              testid="rules-hours-toggle"
            />
            {hoursOn ? (
              <div className="mt-2 grid gap-1.5 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100 sm:grid-cols-2">
                {DAYS.map(([day, label]) => {
                  const range = s.businessHours[day]?.[0]
                  return (
                    <div key={day} className="flex items-center gap-2 text-[12px]">
                      <label className="flex w-24 items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(range)}
                          onChange={(e) =>
                            set({ businessHours: { ...s.businessHours, [day]: e.target.checked ? [['08:00', '17:00']] : undefined } })
                          }
                          className="h-3.5 w-3.5 accent-[#5B6CFF]"
                        />
                        {label}
                      </label>
                      {range ? (
                        <>
                          <input type="time" value={range[0]} onChange={(e) => set({ businessHours: { ...s.businessHours, [day]: [[e.target.value, range[1]]] } })} className="rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200" aria-label={`${label} desde`} />
                          <span className="text-slate-400">a</span>
                          <input type="time" value={range[1]} onChange={(e) => set({ businessHours: { ...s.businessHours, [day]: [[range[0], e.target.value]] } })} className="rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200" aria-label={`${label} hasta`} />
                        </>
                      ) : (
                        <span className="text-slate-400">Cerrado</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <Toggle
              checked={s.autoCloseDays !== null}
              onChange={(v) => set({ autoCloseDays: v ? 7 : null, autoCloseStageKey: v ? s.autoCloseStageKey ?? closedStages[0]?.key ?? null : null })}
              label="Cerrar chats sin movimiento"
              testid="rules-autoclose-toggle"
            />
            {s.autoCloseDays !== null ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-[12.5px] ring-1 ring-slate-100">
                después de
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={s.autoCloseDays}
                  onChange={(e) => set({ autoCloseDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                  className="w-16 rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200"
                  aria-label="Días"
                />
                días, en la etapa
                <select value={s.autoCloseStageKey ?? ''} onChange={(e) => set({ autoCloseStageKey: e.target.value })} className="rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200" aria-label="Etapa de cierre">
                  {closedStages.map((st) => (
                    <option key={st.key} value={st.key}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <span className="w-full text-[11px] text-slate-400">No cierra chats pospuestos ni con tareas pendientes.</span>
              </div>
            ) : null}
            <Toggle
              checked={s.reopenOnInbound || s.autoCloseDays !== null}
              onChange={(v) => set({ reopenOnInbound: v })}
              label="Reabrir un chat cerrado cuando el cliente vuelve a escribir"
              testid="rules-reopen-toggle"
            />
          </section>

          <div className="flex items-center justify-end gap-2">
            {message ? (
              <span role="status" className={`text-[12px] ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
                {message.text}
              </span>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="inline-flex items-center gap-1 rounded-lg bg-au-ink-5b6cff px-3 py-1.5 text-[12.5px] font-semibold text-static-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Guardar
            </button>
          </div>
        </div>
      )}
    </ConfigCard>
  )
}
