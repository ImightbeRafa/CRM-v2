'use client'

import { useEffect, useState } from 'react'

type Row = {
  agentId: string
  agentVersion: number
  model: string | null
  turns: number
  delivered: number
  suggested: number
  fallbackRate: number
  takeoverRate: number
  suggestionAcceptRate: number | null
  thumbsUp: number
  thumbsDown: number
  attendedConversations: number
  conversionRate: number
}

type Payload = {
  days: number
  feedbackReady: boolean
  rows: Row[]
  agentNames: Record<string, { name: string; status: string; version: number }>
}

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)

/** "Are the agents getting better": compare rates between versions of the same agent. */
export default function ScorecardPanel({ days }: { days: number }) {
  const [data, setData] = useState<Payload | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/super-admin/agent-scorecard?days=${days}`, { cache: 'no-store' })
        if (res.ok && !cancelled) setData((await res.json()) as Payload)
      } catch {
        /* optional panel */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [days])

  return (
    <div className="rounded-xl border border-slate-200 bg-white" data-testid="agent-scorecard">
      <h3 className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">
        Calidad por agente y versión
      </h3>
      {!data || data.rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">Sin datos todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Agente</th>
                <th className="px-2 py-2 text-right">Turnos</th>
                <th className="px-2 py-2 text-right">Fallback</th>
                <th className="px-2 py-2 text-right">Sugerencias usadas</th>
                <th className="px-2 py-2 text-right">Tomadas por persona</th>
                <th className="px-2 py-2 text-right">Con pedido ≤7d</th>
                <th className="px-4 py-2 text-right">👍 / 👎</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.agentId}:${r.agentVersion}`} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-900">
                    {data.agentNames[r.agentId]?.name || r.agentId} · v{r.agentVersion}
                    {r.model ? ` · ${r.model}` : ''}
                  </td>
                  <td className="px-2 py-2 text-right">{r.turns}</td>
                  <td className="px-2 py-2 text-right">{pct(r.fallbackRate)}</td>
                  <td className="px-2 py-2 text-right">{pct(r.suggestionAcceptRate)}</td>
                  <td className="px-2 py-2 text-right">{r.delivered ? pct(r.takeoverRate) : '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {r.attendedConversations ? pct(r.conversionRate) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {data.feedbackReady ? `${r.thumbsUp} / ${r.thumbsDown}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
