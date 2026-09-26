import {
  barPercent,
  bucketPairedSeries,
  chartBucketSize,
  formatCompactMoney,
  formatDayLabel,
  formatDeltaLabel,
  pctDelta,
  type PairedDailyPoint,
} from '@/lib/statistics-aurora'
import { AuroraEmptyState } from '../states'

/** "Ventas por día": this period vs the previous one, CSS bars (no chart lib, no invented series). */
export function DailySalesBars({ series, symbol }: { series: PairedDailyPoint[]; symbol: string }) {
  const bucket = chartBucketSize(series.length)
  const points = bucketPairedSeries(series, bucket)
  const max = points.reduce((m, p) => Math.max(m, p.revenue, p.prevRevenue), 0)

  if (max <= 0) {
    return (
      <AuroraEmptyState
        tone="neutral"
        icon="₡"
        title="Sin ventas en este período"
        description="Cuando registres pedidos, vas a ver la comparación con el período anterior acá."
        className="py-10"
      />
    )
  }

  const labelEvery = Math.max(1, Math.ceil(points.length / 7))
  const labelStyle = points.length <= 7 && bucket === 1 ? 'weekday' : 'short'

  return (
    <div>
      <ul
        className="flex h-[200px] items-end gap-1 md:h-[240px] md:gap-2"
        aria-label="Ventas por día, este período contra el anterior"
        data-testid="stats-daily-bars"
      >
        {points.map((p, i) => {
          const delta = pctDelta(p.revenue, p.prevRevenue)
          return (
            <li key={p.date} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <button
                type="button"
                className="flex h-full w-full items-end justify-center gap-[2px] rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#5B6CFF]/40"
                aria-label={`${formatDayLabel(p.date)}: ${formatCompactMoney(p.revenue, symbol)}, anterior ${formatCompactMoney(p.prevRevenue, symbol)}`}
              >
                <span
                  className="w-full max-w-[22px] rounded-t-md bg-[#E9E5FF]"
                  style={{ height: `${barPercent(p.prevRevenue, max)}%` }}
                />
                <span
                  className="w-full max-w-[22px] rounded-t-md bg-gradient-to-t from-[#3B82F6] to-[#7C3AED]"
                  style={{ height: `${barPercent(p.revenue, max)}%` }}
                />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0E0D17] px-2.5 py-1.5 text-center text-[11px] font-semibold text-white group-focus-within:block group-hover:block"
              >
                {formatCompactMoney(p.revenue, symbol)}
                {delta !== null ? (
                  <span className={`block text-[10px] font-medium ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {formatDeltaLabel(delta)} vs ant.
                  </span>
                ) : null}
              </span>
              <span className="mt-2 h-4 truncate text-center text-[11px] text-slate-400">
                {i % labelEvery === 0 ? formatDayLabel(p.date, labelStyle) : ''}
              </span>
            </li>
          )
        })}
      </ul>
      {bucket > 1 ? <p className="mt-1 text-[11px] text-slate-400">Cada barra suma una semana.</p> : null}
    </div>
  )
}

export function DailyLegend({ current, previous }: { current: string; previous: string }) {
  return (
    <div className="flex items-center gap-4 text-[12px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[#5B6CFF]" aria-hidden />
        {current}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[#E9E5FF]" aria-hidden />
        {previous}
      </span>
    </div>
  )
}
