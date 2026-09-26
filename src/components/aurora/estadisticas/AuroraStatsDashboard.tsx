'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MessageSquare, Package, TrendingUp, Wallet } from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import {
  auroraPeriodRange,
  averageTicket,
  formatCompactMoney,
  formatDeltaLabel,
  formatRangeLabel,
  normalizeAuroraPeriod,
  pairDailySeries,
  pctDelta,
  periodCompareLabel,
  safeCount,
  type AuroraPeriod,
  type DailyPoint,
} from '@/lib/statistics-aurora'
import { StatsCard, type CardLoad } from './StatsCard'
import { KpiCard, type KpiDelta } from './KpiCard'
import { DailyLegend, DailySalesBars } from './DailySalesBars'
import { StatusBreakdownBody, type StatusRow } from './StatusBreakdownCard'
import { LinePerformanceBody, type LineRow } from './LinePerformance'
import { FunnelBody } from './FunnelCard'
import { StatsHeader } from './StatsHeader'

// The legacy report (custom range, day report, top customers) stays reachable, lazily loaded.
const EstadisticasDashboard = dynamic(
  () => import('@/app/estadisticas/components/EstadisticasDashboard'),
  { ssr: false, loading: () => <p className="p-4 text-[13px] text-slate-500">Cargando informe…</p> },
)

type StatisticsReadiness = { enabled: boolean; mode: 'observe' | 'primary' }

type Summary = {
  period: AuroraPeriod
  range: { startDate: string; endDate: string }
  previous: { startDate: string; endDate: string }
  revenueMode: 'booked' | 'collected'
  kpis: {
    revenue: { current: number; previous: number }
    orders: { current: number; previous: number }
  }
  daily: DailyPoint[]
  dailyPrevious: DailyPoint[]
  lines: LineRow[] | null
  funnel: { chatsOpened: number | null; aiResponded: number | null; ordersCreated: number }
  chatOrderLink: { available: boolean }
}

type Loaded<T> = { state: CardLoad; data: T | null }

function useJson<T>(url: string | null): [Loaded<T>, () => void] {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading', data: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setResult({ state: 'loading', data: null })
    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return (await res.json()) as T
      })
      .then((data) => setResult({ state: 'ready', data }))
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setResult({ state: 'error', data: null })
      })
    return () => controller.abort()
  }, [url, nonce])
  return [result, () => setNonce((n) => n + 1)]
}

function delta(current: number, previous: number, period: AuroraPeriod): KpiDelta {
  const pct = pctDelta(current, previous)
  return { pct, label: `${formatDeltaLabel(pct)} ${periodCompareLabel(period)}` }
}

function Dashboard({ statistics }: { statistics: StatisticsReadiness }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const period = normalizeAuroraPeriod(searchParams.get('periodo'))
  const [reportOpen, setReportOpen] = useState(false)

  const setPeriod = useCallback(
    (next: AuroraPeriod) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('periodo', next)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // Same Costa Rica day boundary the API uses; only evaluated in the browser after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const range = useMemo(() => (mounted ? auroraPeriodRange(period) : null), [mounted, period])

  const [summary, reloadSummary] = useJson<Summary>(range ? `/api/estadisticas/aurora-summary?period=${period}` : null)
  const [status, reloadStatus] = useJson<StatusRow[]>(
    range ? `/api/estadisticas/status-breakdown?startDate=${range.startDate}&endDate=${range.endDate}` : null,
  )

  const s = summary.data
  const summaryState: CardLoad = summary.state === 'ready' && !s ? 'error' : summary.state
  const rev = s?.kpis.revenue ?? { current: 0, previous: 0 }
  const ord = s?.kpis.orders ?? { current: 0, previous: 0 }
  const avgCur = averageTicket(rev.current, ord.current)
  const avgPrev = averageTicket(rev.previous, ord.previous)
  const series = useMemo(
    () => (s ? pairDailySeries(s.daily, s.dailyPrevious, s.range, s.previous) : []),
    [s],
  )
  const rangeLabel = s ? formatRangeLabel(s.range.startDate, s.range.endDate) : ''
  const kpiState = summaryState
  const noPrev = 'Sin período anterior para comparar'

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="stats-dashboard">
      <StatsHeader period={period} onPeriod={setPeriod} />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-6 pt-5 md:px-7">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            accent="brand"
            icon={<Wallet className="h-4 w-4" />}
            label={s?.revenueMode === 'collected' ? 'Ventas cobradas' : 'Ventas'}
            state={kpiState}
            value={formatCompactMoney(rev.current, symbol)}
            delta={delta(rev.current, rev.previous, period)}
            emptyHint={noPrev}
            onRetry={reloadSummary}
          />
          <KpiCard
            accent="blue"
            icon={<Package className="h-4 w-4" />}
            label="Pedidos"
            state={kpiState}
            value={String(safeCount(ord.current))}
            delta={delta(ord.current, ord.previous, period)}
            emptyHint={noPrev}
            onRetry={reloadSummary}
          />
          <KpiCard
            accent="green"
            icon={<MessageSquare className="h-4 w-4" />}
            label="Chat → pedido"
            state={kpiState}
            value="—"
            emptyHint="Sin datos: los pedidos todavía no se vinculan a un chat"
            onRetry={reloadSummary}
          />
          <KpiCard
            accent="amber"
            icon={<TrendingUp className="h-4 w-4" />}
            label="Ticket promedio"
            state={kpiState}
            value={formatCompactMoney(avgCur, symbol)}
            delta={delta(avgCur, avgPrev, period)}
            emptyHint={noPrev}
            onRetry={reloadSummary}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <StatsCard
            title="Ventas por día"
            subtitle={rangeLabel ? `${symbol} · ${rangeLabel}` : undefined}
            right={<DailyLegend current="Este período" previous="Período anterior" />}
            state={summaryState}
            onRetry={reloadSummary}
            skeletonClass="h-[260px]"
          >
            <DailySalesBars series={series} symbol={symbol} />
          </StatsCard>
          <StatsCard
            title="Pedidos por estado"
            subtitle={rangeLabel || undefined}
            state={status.state}
            onRetry={reloadStatus}
            skeletonClass="h-[200px]"
          >
            <StatusBreakdownBody rows={Array.isArray(status.data) ? status.data : []} />
          </StatsCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <StatsCard
            title="Rendimiento por línea"
            subtitle="Cada número de WhatsApp o cuenta de Instagram es un canal"
            state={summaryState}
            onRetry={reloadSummary}
            skeletonClass="h-[220px]"
          >
            <LinePerformanceBody lines={s?.lines ?? null} />
          </StatsCard>
          <StatsCard
            title="Embudo chat → pedido"
            subtitle={`${rangeLabel || 'Período'} · todas las líneas`}
            state={summaryState}
            onRetry={reloadSummary}
            skeletonClass="h-[220px]"
          >
            <FunnelBody
              chatsOpened={s?.funnel.chatsOpened ?? null}
              aiResponded={s?.funnel.aiResponded ?? null}
              ordersCreated={s?.funnel.ordersCreated ?? 0}
            />
          </StatsCard>
        </div>

        <details
          className="rounded-2xl border border-slate-200/70 bg-white"
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) setReportOpen(true)
          }}
        >
          <summary className="cursor-pointer select-none px-4 py-3.5 text-[14px] font-semibold text-[#0E0D17] md:px-5">
            Informe detallado
            <span className="ml-2 text-[12px] font-normal text-slate-400">
              Rango personalizado, reporte por día y clientes
            </span>
          </summary>
          {reportOpen ? (
            <div className="aurora-light border-t border-slate-100 p-3 md:p-4">
              <EstadisticasDashboard statisticsV2={statistics} />
            </div>
          ) : null}
        </details>
      </div>
    </div>
  )
}

export function AuroraStatsDashboard({ statistics }: { statistics: StatisticsReadiness }) {
  return (
    <Suspense fallback={null}>
      <Dashboard statistics={statistics} />
    </Suspense>
  )
}
