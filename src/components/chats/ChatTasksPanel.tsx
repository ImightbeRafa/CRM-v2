'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Check, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react'

export type TaskItem = {
  id: string
  kind: 'task' | 'reminder' | 'follow_up'
  title: string
  status: 'open' | 'done' | 'canceled'
  dueAt: string | null
  overdue: boolean
  conversationId: string | null
  clientId: string | null
  assignee: { id: string; name: string } | null
  context?: string | null
}

type Teammate = { id: string; name: string }

export const TASK_KIND_LABEL: Record<TaskItem['kind'], string> = {
  task: 'Tarea',
  reminder: 'Recordatorio',
  follow_up: 'Seguimiento',
}

export function formatDue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-CR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Due presets in local time. */
function duePreset(key: string): string | null {
  const d = new Date()
  if (key === 'today') d.setHours(17, 0, 0, 0)
  else if (key === 'tomorrow') {
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
  } else if (key === '3days') {
    d.setDate(d.getDate() + 3)
    d.setHours(9, 0, 0, 0)
  } else if (key === 'week') {
    d.setDate(d.getDate() + 7)
    d.setHours(9, 0, 0, 0)
  } else return null
  return d.toISOString()
}

/** One task row: complete / reopen and cancel. Shared by the chat panel and "Mis tareas". */
export function TaskRow({
  task,
  busy,
  onToggle,
  onCancel,
  extra,
}: {
  task: TaskItem
  busy: boolean
  onToggle: () => void
  onCancel?: () => void
  extra?: React.ReactNode
}) {
  const done = task.status === 'done'
  return (
    <li className={`flex items-start gap-2 rounded-xl px-2.5 py-2 text-[12.5px] ring-1 ${task.overdue ? 'bg-red-50/60 ring-red-200' : 'bg-white ring-slate-100'}`} data-testid="task-row">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Marcar como pendiente' : 'Marcar como hecha'}
        disabled={busy}
        onClick={onToggle}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white hover:border-slate-500'}`}
      >
        {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden /> : done ? <Check className="h-3 w-3" aria-hidden /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`break-words ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-slate-400">
          <span>{TASK_KIND_LABEL[task.kind]}</span>
          {task.dueAt ? (
            <span className={task.overdue ? 'font-semibold text-red-600' : ''}>
              · {task.overdue ? 'Venció ' : ''}
              {formatDue(task.dueAt)}
            </span>
          ) : null}
          {task.assignee ? <span>· {task.assignee.name}</span> : null}
          {extra}
        </p>
      </div>
      {onCancel ? (
        <button type="button" disabled={busy} onClick={onCancel} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar tarea">
          <Trash2 className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </li>
  )
}

/** Tasks / reminders of this chat and its client (Cliente tab). Hidden before migration 036. */
export function ChatTasksPanel({ conversationId }: { conversationId: string }) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<TaskItem['kind']>('follow_up')
  const [due, setDue] = useState('tomorrow')
  const [customDue, setCustomDue] = useState('')
  const [assignee, setAssignee] = useState<string>('')
  const [team, setTeam] = useState<{ viewerId: string | null; list: Teammate[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const res = await fetch(`/api/crm/tasks?conversationId=${encodeURIComponent(conversationId)}`, { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; available?: boolean; tasks?: TaskItem[] } | null
      if (mine !== seq.current) return
      if (!res.ok || !json?.success) {
        setAvailable((a) => a ?? false)
        return
      }
      setAvailable(json.available !== false)
      setTasks(json.tasks ?? [])
    } catch {
      if (mine === seq.current) setError('Sin conexión.')
    }
  }, [conversationId])

  useEffect(() => {
    setTasks(null)
    setAdding(false)
    void load()
  }, [load])

  async function openForm() {
    setAdding(true)
    if (!team) {
      try {
        const res = await fetch('/api/chat/assignees', { credentials: 'same-origin', cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as { viewerUserId?: string; assignees?: Teammate[] } | null
        const next = { viewerId: json?.viewerUserId ?? null, list: Array.isArray(json?.assignees) ? json!.assignees : [] }
        setTeam(next)
        setAssignee((a) => a || next.viewerId || '')
      } catch {
        /* assign to me by default */
      }
    }
  }

  async function add() {
    const t = title.trim()
    if (!t || saving) return
    const dueAt = due === 'custom' ? (customDue ? new Date(customDue).toISOString() : null) : duePreset(due)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/tasks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, title: t, kind, dueAt, ...(assignee ? { assigneeUserId: assignee } : {}) }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setError(json?.error || 'No se pudo crear la tarea.')
        return
      }
      setTitle('')
      setAdding(false)
      await load()
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  async function change(task: TaskItem, method: 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
    setBusyId(task.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${encodeURIComponent(task.id)}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setError(json?.error || 'No se pudo actualizar la tarea.')
        return
      }
      await load()
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  if (available !== true) return null

  return (
    <section className="space-y-2" data-testid="chat-tasks-panel" aria-label="Tareas">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
          <ListChecks className="h-3.5 w-3.5" aria-hidden /> Tareas y recordatorios
        </p>
        {!adding ? (
          <button type="button" onClick={() => void openForm()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-au-ink-5b6cff hover:bg-au-tint-eef0ff">
            <Plus className="h-3 w-3" aria-hidden /> Nueva
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="space-y-1.5 rounded-xl bg-white p-2 ring-1 ring-slate-100">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder="Ej.: Llamar para confirmar la dirección"
            className="w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-900 outline-none ring-1 ring-slate-100 focus:ring-au-ink-5b6cff"
            aria-label="Título de la tarea"
          />
          <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
            <select value={kind} onChange={(e) => setKind(e.target.value as TaskItem['kind'])} className="rounded-md bg-slate-50 px-1.5 py-1 ring-1 ring-slate-200" aria-label="Tipo">
              <option value="follow_up">Seguimiento</option>
              <option value="reminder">Recordatorio</option>
              <option value="task">Tarea</option>
            </select>
            <select value={due} onChange={(e) => setDue(e.target.value)} className="rounded-md bg-slate-50 px-1.5 py-1 ring-1 ring-slate-200" aria-label="Para cuándo">
              <option value="today">Hoy 17:00</option>
              <option value="tomorrow">Mañana 9:00</option>
              <option value="3days">En 3 días</option>
              <option value="week">En una semana</option>
              <option value="none">Sin fecha</option>
              <option value="custom">Otra fecha…</option>
            </select>
            {due === 'custom' ? (
              <input type="datetime-local" value={customDue} onChange={(e) => setCustomDue(e.target.value)} className="col-span-2 rounded-md bg-slate-50 px-1.5 py-1 ring-1 ring-slate-200" aria-label="Fecha y hora" />
            ) : null}
            {team && team.list.length > 1 ? (
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="col-span-2 rounded-md bg-slate-50 px-1.5 py-1 ring-1 ring-slate-200" aria-label="Para quién">
                {team.list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === team.viewerId ? `${t.name} (yo)` : t.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setAdding(false)} className="rounded-md px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!title.trim() || saving}
              onClick={() => void add()}
              className="inline-flex items-center gap-1 rounded-md bg-au-ink-5b6cff px-2.5 py-0.5 text-[11px] font-semibold text-static-white disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <CalendarClock className="h-3 w-3" aria-hidden />}
              Guardar
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-700">
          {error}
        </p>
      ) : null}

      {tasks === null ? (
        <div className="h-10 animate-pulse rounded-xl bg-slate-100" aria-busy="true" />
      ) : tasks.length ? (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              busy={busyId === t.id}
              onToggle={() => void change(t, 'PATCH', { status: t.status === 'done' ? 'open' : 'done' })}
              onCancel={() => void change(t, 'DELETE')}
            />
          ))}
        </ul>
      ) : !adding ? (
        <p className="px-1 text-[11.5px] text-slate-400">Sin tareas pendientes.</p>
      ) : null}
    </section>
  )
}
