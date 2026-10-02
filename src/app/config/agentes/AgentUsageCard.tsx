'use client'

import { useEffect, useState } from 'react'

type Totals = {
  turns: number
  delivered: number
  suggested: number
  skipped: number
  fallback: number
  failed: number
  inputTokens: number
  outputTokens: number
}

const nf = new Intl.NumberFormat('es-CR')

/** Last 30 days of this business's agent activity (volume and outcomes only, no dollars). */
export function AgentUsageCard() {
  const [totals, setTotals] = useState<Totals | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/chat/agents/usage?days=30', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as { summary?: { totals?: Totals } }
        if (!cancelled) setTotals(json.summary?.totals ?? null)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return null
  if (!totals) return <p className="mt-3 text-[12px] text-slate-500">Cargando uso…</p>
  const toHuman = totals.skipped + totals.fallback
  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3" data-testid="agent-usage-card">
      <p className="text-[13px] font-semibold text-slate-900">Últimos 30 días · todos los agentes del negocio</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-slate-700 sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Respuestas enviadas</dt>
          <dd className="text-[15px] font-semibold text-slate-900">{nf.format(totals.delivered)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Sugerencias</dt>
          <dd className="text-[15px] font-semibold text-slate-900">{nf.format(totals.suggested)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Pasó a una persona</dt>
          <dd className="text-[15px] font-semibold text-slate-900">{nf.format(toHuman)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Con error</dt>
          <dd className="text-[15px] font-semibold text-slate-900">{nf.format(totals.failed)}</dd>
        </div>
      </dl>
    </div>
  )
}
