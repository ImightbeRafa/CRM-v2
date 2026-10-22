'use client'

/**
 * Config › Agentes · "Resultados de tus agentes" (Lane E2): per agent and period — chats, replies,
 * hand-offs and why, sales the agent closed vs. finished by a person, money, cost and cost per sale,
 * response time and provider errors. Hidden when the business has no agent access (403 custom_agents).
 */
import { useEffect, useState } from 'react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { formatCompactMoney } from '@/lib/statistics-aurora'
import { formatDurationEs, formatPercent } from '@/lib/insights/stats-math'
import { handoffReasonLabel, microsToUsd, type AgentPerformance } from '@/lib/insights/agent-performance'

type Row = AgentPerformance & { name: string; status: string | null }
type Payload = { range: { startDate: string; endDate: string }; agents: Row[] }

const PERIODS = [
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'mes-pasado', label: 'Mes pasado' },
] as const

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const nf = new Intl.NumberFormat('es-CR')

function money(micros: number | null): string {
  const v = microsToUsd(micros)
  return v === null ? '—' : usd.format(v)
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-tight text-slate-500">{label}</dt>
      <dd className="text-[15px] font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint ? <dd className="text-[10.5px] leading-tight text-slate-400">{hint}</dd> : null}
    </div>
  )
}

function AgentBlock({ row, symbol }: { row: Row; symbol: string }) {
  const sales = row.salesByAgent + row.salesWithHuman
  return (
    <li className="rounded-xl border border-slate-100 p-3" data-testid="agent-performance-row">
      <p className="text-[13.5px] font-semibold text-slate-900">{row.name}</p>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Chats atendidos" value={nf.format(row.chats)} hint={`${nf.format(row.replies)} respuestas`} />
        <Stat label="Pasó a una persona" value={nf.format(row.handoffs)} hint={`${formatPercent(row.handoffRate)} de los chats · ${nf.format(row.reviews)} revisiones`} />
        <Stat label="Ventas que cerró la IA" value={nf.format(row.salesByAgent)} hint={formatCompactMoney(row.soldByAgent, symbol)} />
        <Stat label="Ventas IA + persona" value={nf.format(row.salesWithHuman)} hint={formatCompactMoney(row.soldWithHuman, symbol)} />
        <Stat label="Costo de la IA" value={money(row.costMicros)} hint="estimado, en dólares" />
        <Stat label="Costo por venta" value={sales > 0 ? money(row.costPerSaleMicros) : '—'} hint={sales > 0 ? `${nf.format(sales)} ventas` : 'sin ventas'} />
        <Stat label="Tiempo de respuesta" value={formatDurationEs(row.responseMedianMs)} hint={`9 de 10: ${formatDurationEs(row.responseP90Ms)}`} />
        <Stat label="Fallas del proveedor" value={nf.format(row.providerErrors)} hint={row.providerErrors > 0 ? 'la IA no pudo responder' : 'sin fallas'} />
      </dl>
      {row.handoffReasons.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium text-slate-500">Motivos de los pases y revisiones</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {row.handoffReasons.slice(0, 8).map((r) => (
              <li key={r.reason} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                {handoffReasonLabel(r.reason)} · {nf.format(r.count)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  )
}

export function AgentPerformanceCard() {
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const [period, setPeriod] = useState<string>('30d')
  const [data, setData] = useState<Payload | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setState((s) => (s === 'hidden' ? s : 'loading'))
    fetch(`/api/chat/agents/performance?period=${period}`, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        // No agent access for this business (or role): show nothing.
        if (res.status === 403 || res.status === 401) return setState('hidden')
        if (!res.ok) return setState('error')
        setData((await res.json()) as Payload)
        setState('ready')
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setState('error')
      })
    return () => controller.abort()
  }, [period])

  if (state === 'hidden') return null
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/80" data-testid="agent-performance-card">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Resultados de tus agentes</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">Chats, ventas y costo de cada agente. Las pruebas no cuentan.</p>
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium ${period === p.key ? 'bg-au-tint-eef0ff text-au-ink-5b6cff' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>
      {state === 'loading' ? <div className="mt-3 h-32 animate-pulse rounded-xl bg-slate-100" aria-hidden /> : null}
      {state === 'error' ? <p className="mt-3 text-[12px] text-red-600">No pudimos cargar los resultados. Probá de nuevo en un momento.</p> : null}
      {state === 'ready' && data ? (
        data.agents.length === 0 ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[12.5px] text-slate-500">
            Tus agentes todavía no atendieron chats en este período. Cuando respondan, vas a ver aquí cuántos chats atendieron y cuánto
            vendieron.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.agents.map((row) => (
              <AgentBlock key={row.agentId} row={row} symbol={symbol} />
            ))}
          </ul>
        )
      ) : null}
      <details className="mt-3 text-[11px] text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">¿De dónde salen estos números?</summary>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>Respuestas y pases a una persona: cada respuesta del agente en chats reales del período (sin pruebas).</li>
          <li>
            “Cerró la IA”: el agente llevó al cliente hasta el pedido o el pago y pasó el chat solo para confirmarlo. “IA + persona”: el agente
            respondió pero el equipo tuvo que seguir por otro motivo. Solo cuentan pedidos vinculados al chat, con respuestas del agente en los 7
            días antes del pedido.
          </li>
          <li>Tiempo de respuesta: desde el mensaje del cliente hasta que la respuesta llegó al chat. Incluye la pausa que configuraste y las esperas fuera de horario.</li>
          <li>Costo: estimado en dólares según el uso del modelo. Fallas del proveedor: veces que la IA no pudo responder (por ejemplo sin crédito o sin conexión).</li>
        </ul>
        {data ? <p className="mt-1.5 text-slate-400">Período: {data.range.startDate} a {data.range.endDate} (hora de Costa Rica).</p> : null}
      </details>
    </section>
  )
}
