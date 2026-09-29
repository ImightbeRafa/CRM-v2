'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ListChecks, MessageSquare } from 'lucide-react'
import { AuroraPageHeader } from '@/components/aurora/shell/AuroraPageHeader'
import { TaskRow, type TaskItem } from '@/components/chats/ChatTasksPanel'

type Filter = 'open' | 'all'

/** "Mis tareas": everything assigned to me, overdue first, with a link to the chat. */
export function MyTasksClient() {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [filter, setFilter] = useState<Filter>('open')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/tasks?mine=1${filter === 'all' ? '&includeDone=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; available?: boolean; tasks?: TaskItem[] } | null
      if (!res.ok || !json?.success) {
        setError('No se pudieron cargar tus tareas.')
        setTasks([])
        return
      }
      setError(null)
      setAvailable(json.available !== false)
      setTasks(json.tasks ?? [])
    } catch {
      setError('Sin conexión.')
      setTasks([])
    }
  }, [filter])

  useEffect(() => {
    setTasks(null)
    void load()
  }, [load])

  async function toggle(task: TaskItem) {
    setBusyId(task.id)
    try {
      const res = await fetch(`/api/crm/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: task.status === 'done' ? 'open' : 'done' }),
      })
      if (!res.ok) setError('No se pudo actualizar la tarea.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const overdue = useMemo(() => (tasks ?? []).filter((t) => t.overdue).length, [tasks])

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <AuroraPageHeader
        title="Mis tareas"
        subtitle={overdue ? `${overdue} vencida${overdue === 1 ? '' : 's'} · lo más urgente arriba` : 'Seguimientos y recordatorios asignados a vos'}
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-au-tint-eef0ff text-au-ink-4a46e5" aria-hidden>
            <ListChecks className="h-5 w-5" />
          </span>
        }
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:px-6">
        <div className="mb-3 inline-flex rounded-lg bg-white p-0.5 text-[12.5px] ring-1 ring-slate-200" role="tablist">
          {(
            [
              ['open', 'Pendientes'],
              ['all', 'Todas'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1 font-medium ${filter === key ? 'bg-au-tint-eef0ff text-au-ink-4a46e5' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p> : null}

        {!available ? (
          <p className="rounded-xl bg-white px-4 py-6 text-center text-[13px] text-slate-500 ring-1 ring-slate-200">Las tareas estarán disponibles en breve.</p>
        ) : tasks === null ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-white ring-1 ring-slate-100" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl bg-white px-4 py-10 text-center ring-1 ring-slate-200" data-testid="my-tasks-empty">
            <p className="text-[14px] font-semibold text-slate-900">Nada pendiente 🎉</p>
            <p className="mt-1 text-[12.5px] text-slate-500">Creá seguimientos desde un chat, en la pestaña Cliente.</p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="my-tasks-list">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                busy={busyId === t.id}
                onToggle={() => void toggle(t)}
                extra={
                  t.conversationId ? (
                    <Link href={`/chats?c=${encodeURIComponent(t.conversationId)}`} className="inline-flex items-center gap-0.5 font-medium text-au-ink-5b6cff hover:underline">
                      · <MessageSquare className="h-3 w-3" aria-hidden /> {t.context || 'Abrir chat'}
                    </Link>
                  ) : t.context ? (
                    <span>· {t.context}</span>
                  ) : null
                }
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
