'use client'

import { useCallback, useEffect, useState } from 'react'

type Row = {
  agentId: string
  agentVersion: number
  turns: number
  delivered: number
  suggested: number
  takeoverRate: number
  suggestionAcceptRate: number | null
  thumbsUp: number
  thumbsDown: number
  conversionRate: number
  attendedConversations: number
  fallbackRate: number
}

type Run = { id: string; agentVersion: number; suite?: string; examined: number; passRate: number; policyViolations: number; createdAt: string }

const pct = (n: number) => `${Math.round(n * 100)}%`

/** Is this agent getting better? Rates by version + the automatic safety test. No dollars here. */
export function AgentQualityCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ready, setReady] = useState(true)

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        fetch('/api/chat/agents/scorecard?days=30', { cache: 'no-store' }),
        fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/eval`, { cache: 'no-store' }),
      ])
      if (s.ok) {
        const json = (await s.json()) as { rows?: Row[]; feedbackReady?: boolean }
        setRows((json.rows ?? []).filter((r) => r.agentId === agentId))
        setReady(json.feedbackReady !== false)
      }
      if (e.ok) setRuns(((await e.json()) as { runs?: Run[] }).runs ?? [])
    } catch {
      /* optional card */
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function runEval() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/eval`, { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as {
        passRate?: number
        examined?: number
        policyViolations?: number
        saved?: boolean
        failures?: Array<{ id: string; reason: string }>
        error?: string
      }
      if (!res.ok) setMessage(json.error || 'No se pudo ejecutar.')
      else {
        const fails = json.failures?.length ?? 0
        setMessage(
          fails === 0
            ? `Todas las pruebas pasaron (${json.examined}).`
            : `${fails} de ${json.examined} pruebas fallaron: ${json.failures
                ?.slice(0, 3)
                .map((f) => f.reason)
                .join('; ')}.`,
        )
        if (json.saved === false) setMessage((m) => `${m ?? ''} (Resultado no guardado: falta activar el historial.)`)
        await load()
      }
    } catch {
      setMessage('No se pudo ejecutar. Intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3" data-testid="agent-quality-card">
      <p className="text-[13px] font-semibold text-slate-900">Calidad por versión (30 días)</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-[12px] text-slate-500">Todavía no hay suficientes conversaciones.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-2">Versión</th>
                <th className="px-2 py-1 text-right">Turnos</th>
                <th className="px-2 py-1 text-right">Sugerencias usadas</th>
                <th className="px-2 py-1 text-right">Tomadas por persona</th>
                <th className="px-2 py-1 text-right">Con pedido en 7 días</th>
                <th className="px-2 py-1 text-right">👍 / 👎</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agentVersion} className="border-t border-slate-200">
                  <td className="py-1 pr-2 font-medium text-slate-900">v{r.agentVersion}</td>
                  <td className="px-2 py-1 text-right">{r.turns}</td>
                  <td className="px-2 py-1 text-right">
                    {r.suggestionAcceptRate === null ? '—' : pct(r.suggestionAcceptRate)}
                  </td>
                  <td className="px-2 py-1 text-right">{r.delivered ? pct(r.takeoverRate) : '—'}</td>
                  <td className="px-2 py-1 text-right">
                    {r.attendedConversations ? pct(r.conversionRate) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {ready ? `${r.thumbsUp} / ${r.thumbsDown}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => void runEval()}
          className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-medium text-slate-800 ring-1 ring-slate-300 disabled:opacity-50"
        >
          {busy ? 'Probando…' : 'Probar reglas de seguridad'}
        </button>
        {(() => {
          const safety = runs.find((r) => r.suite === 'safety_rules_v2')
          const play = runs.find((r) => r.suite === 'probar_scenarios')
          return (
            <>
              {safety ? (
                <span className="text-[11px] text-slate-500">
                  Reglas de seguridad: v{safety.agentVersion} · {pct(safety.passRate)} aprobado
                  {safety.policyViolations ? ` · ${safety.policyViolations} infracciones` : ''}
                </span>
              ) : null}
              {play ? (
                <span className="text-[11px] text-slate-500">
                  Playground (informado por el navegador): v{play.agentVersion} · {pct(play.passRate)} de {play.examined}
                </span>
              ) : null}
            </>
          )
        })()}
      </div>
      {message ? <p className="mt-2 text-[12px] text-slate-700">{message}</p> : null}
    </div>
  )
}
