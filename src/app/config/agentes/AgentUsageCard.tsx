'use client'

import { useEffect, useState } from 'react'

type Spend = {
  todayUsd: number
  periodUsd: number
  delivered: number
  avgPerReplyUsd: number
  testUsd: number
  testTurns: number
  byAgent: Array<{ agentId: string; delivered: number; costUsd: number }>
}

type AgentInfo = { name: string }

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const nf = new Intl.NumberFormat('es-CR')

/** This business's reply cost. Tests are shown apart and do not stop live answers. */
export function AgentUsageCard({ prominent = false }: { prominent?: boolean }) {
  const [spend, setSpend] = useState<Spend | null>(null)
  const [names, setNames] = useState<Record<string, AgentInfo>>({})
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/chat/agents/usage?days=30', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as { spend?: Spend; agentNames?: Record<string, AgentInfo> }
        if (cancelled) return
        setSpend(json.spend ?? null)
        setNames(json.agentNames ?? {})
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (failed || !spend) return null
  return (
    <section className={prominent ? 'rounded-2xl bg-white p-4 ring-1 ring-slate-200/80' : 'mt-4 rounded-lg bg-slate-50 p-3'} data-testid="agent-usage-card">
      <h2 className="text-[14px] font-semibold text-slate-900">Uso de la IA</h2>
      <p className="mt-0.5 text-[12px] text-slate-500">Estimado de las respuestas. Las pruebas no frenan los chats.</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hoy" value={usd.format(spend.todayUsd)} />
        <Stat label="30 días" value={usd.format(spend.periodUsd)} />
        <Stat label="Respuestas" value={nf.format(spend.delivered)} />
        <Stat label="Promedio por respuesta" value={usd.format(spend.avgPerReplyUsd)} />
      </dl>
      <p className="mt-3 text-[12px] text-slate-500">
        Pruebas en 30 días: {usd.format(spend.testUsd)} · {nf.format(spend.testTurns)} corridas. Eso no apaga las respuestas.
      </p>
      {spend.byAgent.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[12px] text-slate-700">
          {spend.byAgent.slice(0, 6).map((row) => (
            <li key={row.agentId} className="flex justify-between gap-3">
              <span className="truncate">{names[row.agentId]?.name || 'Agente'}</span>
              <span className="shrink-0 tabular-nums">{usd.format(row.costUsd)} · {nf.format(row.delivered)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-[16px] font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}
