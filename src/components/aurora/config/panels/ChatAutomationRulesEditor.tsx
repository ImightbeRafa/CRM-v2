'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ConfigCard } from '@/components/aurora/config/panels/ConfigCard'
import { useCrmCatalog } from '@/components/chats/useCrmCatalog'
import type { ActionKind, TriggerKind } from '@/lib/chat-automation-rules'

type Rule = {
  id: string
  name: string
  enabled: boolean
  triggerKind: TriggerKind
  triggerConfig: { minutes?: number; keywords?: string[] }
  actionKind: ActionKind
  actionConfig: { tag?: string; userId?: string; title?: string; dueInMinutes?: number | null }
  runs24h: number
}
type Teammate = { id: string; name: string }

const TRIGGERS: Array<[TriggerKind, string]> = [
  ['new_chat', 'Llega un chat nuevo'],
  ['idle', 'El cliente espera respuesta'],
  ['keyword', 'El cliente escribe una palabra'],
]
const ACTIONS: Array<[ActionKind, string]> = [
  ['tag', 'Ponerle una etiqueta'],
  ['assign', 'Asignarlo a una persona'],
  ['task', 'Crear una tarea de seguimiento'],
]

function describe(rule: Rule, team: Teammate[]): string {
  const when =
    rule.triggerKind === 'new_chat'
      ? 'Cuando llega un chat nuevo'
      : rule.triggerKind === 'idle'
        ? `Cuando el cliente espera respuesta ${rule.triggerConfig.minutes} min`
        : `Cuando el cliente escribe: ${(rule.triggerConfig.keywords || []).join(', ')}`
  const then =
    rule.actionKind === 'tag'
      ? `ponerle la etiqueta "${rule.actionConfig.tag}"`
      : rule.actionKind === 'assign'
        ? `asignarlo a ${team.find((t) => t.id === rule.actionConfig.userId)?.name || 'una persona'}`
        : `crear la tarea "${rule.actionConfig.title}"`
  return `${when} → ${then}`
}

/**
 * Config › Chats: simple automation rules. They only do INTERNAL things (tag, assign, create a follow-up
 * task) — a rule never writes to a customer. Every rule starts turned off.
 */
export function ChatAutomationRulesEditor() {
  const { activeTags } = useCrmCatalog()
  const [available, setAvailable] = useState(true)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [team, setTeam] = useState<Teammate[]>([])
  const [canEdit, setCanEdit] = useState(true)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [triggerKind, setTriggerKind] = useState<TriggerKind>('new_chat')
  const [minutes, setMinutes] = useState(30)
  const [keywords, setKeywords] = useState('')
  const [actionKind, setActionKind] = useState<ActionKind>('tag')
  const [tag, setTag] = useState('')
  const [userId, setUserId] = useState('')
  const [title, setTitle] = useState('')
  const [dueMinutes, setDueMinutes] = useState(60)

  const load = useCallback(async () => {
    try {
      const [r, people] = await Promise.all([
        fetch('/api/config/chat-automations', { credentials: 'same-origin', cache: 'no-store' }).then((x) => x.json().catch(() => null)),
        fetch('/api/chat/assignees', { credentials: 'same-origin', cache: 'no-store' }).then((x) => x.json().catch(() => null)),
      ])
      if (r?.success) {
        setAvailable(r.available !== false)
        setRules(r.rules ?? [])
      } else {
        setAvailable(false)
      }
      setTeam(Array.isArray(people?.assignees) ? people.assignees : [])
    } catch {
      setAvailable(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/config/chat-automations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          enabled: false,
          triggerKind,
          triggerConfig:
            triggerKind === 'idle'
              ? { minutes }
              : triggerKind === 'keyword'
                ? { keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) }
                : {},
          actionKind,
          actionConfig:
            actionKind === 'tag' ? { tag } : actionKind === 'assign' ? { userId } : { title, dueInMinutes: dueMinutes },
        }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        if (res.status === 403) setCanEdit(false)
        setMessage({ tone: 'error', text: json?.error || 'No se pudo guardar.' })
        return
      }
      setName('')
      setTag('')
      setTitle('')
      setKeywords('')
      setMessage({ tone: 'ok', text: 'Regla creada (apagada). Activala cuando quieras.' })
      await load()
    } catch {
      setMessage({ tone: 'error', text: 'Sin conexión.' })
    } finally {
      setBusy(false)
    }
  }

  async function toggle(rule: Rule, enabled: boolean) {
    setBusy(true)
    try {
      const res = await fetch(`/api/config/chat-automations/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) setMessage({ tone: 'error', text: 'No se pudo cambiar.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`¿Borrar la regla "${rule.name}"?`)) return
    setBusy(true)
    try {
      await fetch(`/api/config/chat-automations/${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const field = 'rounded-md bg-white px-2 py-1 text-[12.5px] ring-1 ring-slate-200'
  return (
    <ConfigCard className="p-5" data-testid="chats-config-automations">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Automatizaciones</h2>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          Reglas simples para el equipo: etiquetar, asignar o crear una tarea. Nunca le escriben al cliente. Cada
          regla nace apagada.
        </p>
      </div>
      {!available ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Las automatizaciones se activan con la próxima actualización.
        </p>
      ) : rules === null ? (
        <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <div className="space-y-4">
          {rules.length === 0 ? (
            <p className="text-[12.5px] text-slate-500">Todavía no hay reglas.</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <label className="flex items-center gap-2 text-[12.5px] font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={busy || !canEdit}
                      onChange={(e) => void toggle(rule, e.target.checked)}
                      className="h-4 w-4 accent-[#5B6CFF]"
                      aria-label={`Activar ${rule.name}`}
                    />
                    {rule.name}
                  </label>
                  <span className="min-w-0 flex-1 text-[12px] text-slate-500">{describe(rule, team)}</span>
                  <span className="text-[11px] text-slate-400">{rule.runs24h} en 24 h</span>
                  <button
                    type="button"
                    disabled={busy || !canEdit}
                    onClick={() => void remove(rule)}
                    className="text-[11.5px] text-red-600 hover:underline disabled:opacity-40"
                  >
                    Borrar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <p className="text-[12.5px] font-semibold text-slate-800">Nueva regla</p>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nombre (ej. Etiquetar preguntas de precio)" className={`${field} w-full`} aria-label="Nombre de la regla" />
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-700">
              <span>Cuando</span>
              <select value={triggerKind} onChange={(e) => setTriggerKind(e.target.value as TriggerKind)} className={field} aria-label="Disparador">
                {TRIGGERS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {triggerKind === 'idle' ? (
                <>
                  <input type="number" min={5} max={10080} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 5)} className={`${field} w-20`} aria-label="Minutos" />
                  <span>minutos</span>
                </>
              ) : null}
              {triggerKind === 'keyword' ? (
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="precio, cuánto sale" className={`${field} min-w-[200px] flex-1`} aria-label="Palabras" />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-700">
              <span>Entonces</span>
              <select value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionKind)} className={field} aria-label="Acción">
                {ACTIONS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              {actionKind === 'tag' ? (
                <select value={tag} onChange={(e) => setTag(e.target.value)} className={field} aria-label="Etiqueta">
                  <option value="">Elegí una etiqueta…</option>
                  {activeTags.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {actionKind === 'assign' ? (
                <select value={userId} onChange={(e) => setUserId(e.target.value)} className={field} aria-label="Persona">
                  <option value="">Elegí una persona…</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {actionKind === 'task' ? (
                <>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Título de la tarea" className={`${field} min-w-[200px] flex-1`} aria-label="Título" />
                  <span>en</span>
                  <input type="number" min={0} max={43200} value={dueMinutes} onChange={(e) => setDueMinutes(Number(e.target.value) || 0)} className={`${field} w-20`} aria-label="Plazo en minutos" />
                  <span>min</span>
                </>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2">
              {message ? (
                <span role="status" className={`text-[12px] ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
                  {message.text}
                </span>
              ) : null}
              <button
                type="button"
                disabled={busy || !canEdit || !name.trim()}
                onClick={() => void create()}
                className="inline-flex items-center gap-1 rounded-lg bg-au-ink-5b6cff px-3 py-1.5 text-[12.5px] font-semibold text-static-white disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                Crear regla
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfigCard>
  )
}
