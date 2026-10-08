'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type CaseResult = { id: string; title: string; group: string; grading: 'rule' | 'judge'; pass: boolean; reply: string; notes: string[]; error?: string | null }
type Run = {
  id: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cost_capped' | 'canceled' | 'error'
  total: number
  done: number
  summary: { rulePassed: number; ruleTotal: number; judgedPassed: number; judgedTotal: number; passed: boolean } | null
  results: CaseResult[]
  cases: Array<{ id: string; title: string; group: string }>
}
type Status = { active: boolean; retestSuggested: boolean; runCurrent?: boolean; run: Run | null }

const GROUP_LABEL: Record<string, string> = {
  productos: 'Productos',
  pagos: 'Pagos',
  seguridad: 'Seguridad',
  conversacion: 'Conversación',
}

/**
 * Probar y activar (F1): the agent's own tests on this channel, then one click and it answers directly.
 * Plain words only; no internal ids or mode names.
 */
export function AgentActivationCard({
  agentId,
  socialAccountId,
  channelLabel,
  canEdit,
  onChanged,
}: {
  agentId: string
  socialAccountId: string | null
  channelLabel: string
  canEdit: boolean
  onChanged?: () => void
}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!socialAccountId) return
    try {
      const res = await fetch(
        `/api/chat/agents/${encodeURIComponent(agentId)}/activation?socialAccountId=${encodeURIComponent(socialAccountId)}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const json = (await res.json()) as Status
      setStatus(json)
    } catch {
      /* optional card */
    }
  }, [agentId, socialAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const running = status?.run?.status === 'queued' || status?.run?.status === 'running'
  useEffect(() => {
    if (!running) return
    timer.current = window.setInterval(() => void load(), 3000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [running, load])

  async function act(action: 'test' | 'activate' | 'deactivate') {
    if (!socialAccountId) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/activation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, socialAccountId }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage(json.error || 'No se pudo completar.')
      await load()
      if (res.ok && action !== 'test') onChanged?.()
    } catch {
      setMessage('No se pudo completar. Intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (!socialAccountId) return null
  const run = status?.run ?? null
  const passed = run?.status === 'passed' && status?.runCurrent === true
  const passedButOld = run?.status === 'passed' && status?.runCurrent === false
  const resultsById = new Map((run?.results ?? []).map((r) => [r.id, r]))

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="agent-activation-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Probar y activar · {channelLabel}</p>
          <p className="mt-0.5 text-[12px] text-slate-600">
            {status?.active
              ? 'Activo: el agente responde solo en este canal.'
              : 'Betsy prueba al agente con sus propios datos. Si todo sale bien, lo activás con un clic.'}
          </p>
        </div>
        {status?.active ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800 ring-1 ring-emerald-200">Respondiendo</span>
        ) : null}
      </div>

      {status?.retestSuggested ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Cambiaste datos del agente desde la última prueba. Sigue respondiendo; conviene volver a probar.
        </p>
      ) : null}

      {run ? (
        <div className="mt-3">
          <p className="text-[12.5px] text-slate-800">
            {running
              ? `Probando… ${run.done} de ${run.total}`
              : run.status === 'passed' && passedButOld
                ? 'Cambiaste el agente después de esta prueba. Volvé a probar para activarlo.'
                : run.status === 'passed'
                ? `Pruebas en verde (${run.results.filter((r) => r.pass).length} de ${run.total}).`
                : run.status === 'failed'
                  ? `Algunas pruebas fallaron (${run.results.filter((r) => r.pass).length} de ${run.total} bien).`
                  : run.status === 'cost_capped'
                    ? 'La prueba se detuvo por el límite de costo. Volvé a intentar.'
                    : 'La prueba no terminó. Volvé a intentar.'}
          </p>
          <ul className="mt-2 space-y-1">
            {run.cases.map((c) => {
              const r = resultsById.get(c.id)
              const mark = !r ? '·' : r.pass ? '✓' : '✗'
              return (
                <li key={c.id} className="text-[12.5px]">
                  <button
                    type="button"
                    onClick={() => setOpen(open === c.id ? null : c.id)}
                    className={`flex w-full items-center gap-2 text-left ${!r ? 'text-slate-400' : r.pass ? 'text-slate-800' : 'text-red-800'}`}
                  >
                    <span className="w-4 shrink-0 text-center">{mark}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {GROUP_LABEL[c.group] || c.group} · {c.title}
                    </span>
                  </button>
                  {open === c.id && r ? (
                    <div className="ml-6 mt-1 rounded-lg bg-slate-50 p-2 text-[12px] text-slate-700">
                      <p className="whitespace-pre-wrap">{r.reply || '(pasó el chat a una persona)'}</p>
                      {r.notes.length ? <p className="mt-1 text-red-800">{r.notes.join(' ')}</p> : null}
                      {r.error ? <p className="mt-1 text-red-800">No se pudo correr esta prueba.</p> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || running}
            onClick={() => void act('test')}
            className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-900 ring-1 ring-slate-300 disabled:opacity-50"
          >
            {running ? 'Probando…' : run ? 'Volver a probar' : 'Probar agente'}
          </button>
          {!status?.active ? (
            <button
              type="button"
              disabled={busy || !passed}
              onClick={() => void act('activate')}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:bg-indigo-300"
              title={passed ? '' : 'Primero las pruebas tienen que quedar en verde'}
            >
              Activar
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act('deactivate')}
              className="rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium text-red-700 ring-1 ring-red-200 disabled:opacity-50"
            >
              Desactivar
            </button>
          )}
        </div>
      ) : null}
      {message ? <p className="mt-2 text-[12px] text-red-700">{message}</p> : null}
    </div>
  )
}
