'use client'

/**
 * Config › Agentes · "Resultados de tus agentes" (Lane E2): per agent and period — chats, replies,
 * hand-offs and why, sales the agent closed vs. finished by a person, money, cost and cost per sale,
 * response time and provider errors. Hidden when the business has no agent access (403 custom_agents).
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, CalendarRange, CircleDollarSign, Database, HelpCircle, MessagesSquare, ShoppingBag, Timer, UserRound } from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { formatCompactMoney, formatRangeLabel } from '@/lib/statistics-aurora'
import { formatDurationEs, formatPercent } from '@/lib/insights/stats-math'
import { handoffReasonLabel, microsToUsd, type AgentPerformance } from '@/lib/insights/agent-performance'
import { BarList, NEUTRAL_SERIES, SERIES, Segmented, SplitBar, StatTile, StatusChip } from './charts'

type Row = AgentPerformance & { name: string; status: string | null }
type Payload = { range: { startDate: string; endDate: string }; agents: Row[] }

const PERIODS = [
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: 'mes', label: 'Este mes' },
  { key: 'mes-pasado', label: 'Mes pasado' },
] as const
type PeriodKey = (typeof PERIODS)[number]['key']

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const nf = new Intl.NumberFormat('es-CR')

function money(micros: number | null): string {
  const v = microsToUsd(micros)
  return v === null ? '—' : usd.format(v)
}

function AgentBlock({ row, symbol }: { row: Row; symbol: string }) {
  const sales = row.salesByAgent + row.salesWithHuman
  const live = row.status === 'live'
  return (
    <li className="rounded-xl border border-slate-100 p-3.5 md:p-4" data-testid="agent-performance-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-au-tint-eef0ff text-au-ink-5b6cff" aria-hidden>
            <Bot className="h-4 w-4" />
          </span>
          {row.name}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip tone={live ? 'good' : 'neutral'}>{live ? 'Activo' : 'No activo'}</StatusChip>
          {row.providerErrors > 0 ? (
            <StatusChip tone="critical" icon={AlertTriangle}>
              {nf.format(row.providerErrors)} fallas del proveedor
            </StatusChip>
          ) : (
            <StatusChip tone="good">Sin fallas del proveedor</StatusChip>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile icon={MessagesSquare} label="Chats atendidos" value={nf.format(row.chats)} hint={`${nf.format(row.replies)} respuestas`} />
        <StatTile icon={ShoppingBag} tone="green" label="Ventas" value={nf.format(sales)} hint={formatCompactMoney(row.soldByAgent + row.soldWithHuman, symbol)} />
        <StatTile
          icon={CircleDollarSign}
          tone="amber"
          label="Costo por venta"
          value={sales > 0 ? money(row.costPerSaleMicros) : '—'}
          hint={`costo total ${money(row.costMicros)} (estimado)`}
        />
        <StatTile icon={Timer} tone="pink" label="Tiempo de respuesta" value={formatDurationEs(row.responseMedianMs)} hint={`9 de 10: ${formatDurationEs(row.responseP90Ms)}`} />
      </dl>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="text-[12px] font-semibold text-slate-700">Quién cerró las ventas</p>
          <p className="mb-2.5 text-[11px] text-slate-400">Pedidos vinculados al chat</p>
          {sales > 0 ? (
            <SplitBar
              label="Ventas que cerró la IA y ventas IA más persona"
              parts={[
                { key: 'ai', label: 'Cerró la IA', value: row.salesByAgent, display: `${nf.format(row.salesByAgent)} · ${formatCompactMoney(row.soldByAgent, symbol)}`, cls: SERIES[0] },
                { key: 'mix', label: 'IA + persona', value: row.salesWithHuman, display: `${nf.format(row.salesWithHuman)} · ${formatCompactMoney(row.soldWithHuman, symbol)}`, cls: SERIES[1] },
              ]}
            />
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] text-slate-500">Sin ventas vinculadas en este período.</p>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
              <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Pasó a una persona
            </p>
            <span className="text-[12px] tabular-nums text-slate-500">
              <span className="font-semibold text-slate-900">{nf.format(row.handoffs)}</span> · {formatPercent(row.handoffRate)} de los chats · {nf.format(row.reviews)} revisiones
            </span>
          </div>
          <p className="mb-2.5 text-[11px] text-slate-400">Motivos de los pases y revisiones</p>
          <BarList
            rows={row.handoffReasons.slice(0, 5).map((r, i) => ({
              key: r.reason,
              label: handoffReasonLabel(r.reason),
              value: r.count,
              display: nf.format(r.count),
              cls: i === 0 ? SERIES[2] : NEUTRAL_SERIES,
            }))}
            empty={<p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] text-slate-500">No pasó ningún chat a una persona.</p>}
          />
        </div>
      </div>
    </li>
  )
}

export function AgentPerformanceCard() {
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const [period, setPeriod] = useState<PeriodKey>('30d')
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
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:p-5" data-testid="agent-performance-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-au-tint-eef0ff text-au-ink-5b6cff" aria-hidden>
            <Bot className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-slate-900">Resultados de tus agentes</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">Chats, ventas y costo de cada agente. Las pruebas no cuentan.</p>
          </div>
        </div>
        <Segmented value={period} options={PERIODS} onChange={setPeriod} label="Período" />
      </header>
      {state === 'loading' ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : null}
      {state === 'error' ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
          <AlertTriangle className="h-4 w-4" aria-hidden /> No pudimos cargar los resultados. Probá de nuevo en un momento.
        </p>
      ) : null}
      {state === 'ready' && data ? (
        data.agents.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-xl bg-slate-50 px-4 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-au-tint-eef0ff text-au-ink-5b6cff" aria-hidden>
              <Bot className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[13.5px] font-semibold text-slate-800">Tus agentes todavía no atendieron chats en este período</p>
            <p className="mt-1 max-w-[340px] text-[12px] text-slate-500">Cuando respondan, vas a ver aquí cuántos chats atendieron y cuánto vendieron.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.agents.map((row) => (
              <AgentBlock key={row.agentId} row={row} symbol={symbol} />
            ))}
          </ul>
        )
      ) : null}
      <div className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {data ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
              <CalendarRange className="h-3 w-3" aria-hidden />
              {formatRangeLabel(data.range.startDate, data.range.endDate)}
            </span>
          ) : null}
          <span>
            <Database className="mr-1 inline h-3 w-3 -translate-y-px" aria-hidden />
            <span className="font-medium text-slate-500">Fuente:</span> respuestas del agente en chats reales y pedidos vinculados al chat · costo
            estimado en dólares
          </span>
        </div>
        <details className="mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-slate-500">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden /> ¿De dónde salen estos números?
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-slate-500">
            <li>Respuestas y pases a una persona: cada respuesta del agente en chats reales del período (sin pruebas).</li>
            <li>
              “Cerró la IA”: el agente llevó al cliente hasta el pedido o el pago y pasó el chat solo para confirmarlo. “IA + persona”: el agente
              respondió pero el equipo tuvo que seguir por otro motivo. Solo cuentan pedidos vinculados al chat, con respuestas del agente en los 7
              días antes del pedido.
            </li>
            <li>Tiempo de respuesta: desde el mensaje del cliente hasta que la respuesta llegó al chat. Incluye la pausa que configuraste y las esperas fuera de horario.</li>
            <li>Costo: estimado en dólares según el uso del modelo. Fallas del proveedor: veces que la IA no pudo responder (por ejemplo sin crédito o sin conexión).</li>
          </ul>
        </details>
      </div>
    </section>
  )
}
