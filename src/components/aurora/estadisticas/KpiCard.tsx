import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import type { CardLoad } from './StatsCard'

type Accent = 'brand' | 'blue' | 'green' | 'amber'

const ACCENT: Record<Accent, { bar: string; tile: string }> = {
  brand: { bar: 'from-[#5B6CFF] to-[#A855F7]', tile: 'bg-[#EEF0FF] text-[#5B6CFF]' },
  blue: { bar: 'from-[#5B6CFF] to-[#38BDF8]', tile: 'bg-sky-50 text-sky-600' },
  green: { bar: 'from-emerald-400 to-[#5B6CFF]', tile: 'bg-emerald-50 text-emerald-600' },
  amber: { bar: 'from-amber-400 to-orange-400', tile: 'bg-amber-50 text-amber-600' },
}

export type KpiDelta = { pct: number | null; label: string }

export function KpiCard({
  accent,
  icon,
  label,
  state,
  value,
  delta,
  emptyHint,
  onRetry,
}: {
  accent: Accent
  icon: ReactNode
  label: string
  state: CardLoad
  value: string
  /** Rendered only with a comparable previous period; otherwise `emptyHint`. */
  delta?: KpiDelta
  emptyHint?: string
  onRetry: () => void
}) {
  const a = ACCENT[accent]
  const up = delta && delta.pct !== null ? delta.pct >= 0 : null
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white px-4 pb-4 pt-5"
      data-testid="stats-kpi"
      aria-busy={state === 'loading'}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${a.bar}`} aria-hidden />
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.tile}`} aria-hidden>
          {icon}
        </span>
        <span className="text-[13px] text-slate-500">{label}</span>
      </div>
      {state === 'loading' ? (
        <div className="mt-3 animate-pulse space-y-2" aria-hidden data-testid="stats-skeleton">
          <div className="h-7 w-28 rounded bg-slate-100" />
          <div className="h-3 w-36 rounded bg-slate-100" />
        </div>
      ) : state === 'error' ? (
        <div className="mt-3" role="alert">
          <p className="text-[13px] text-slate-500">No se pudo cargar</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-[12px] font-medium text-[#5B3FE0] hover:underline"
          >
            ↻ Reintentar
          </button>
        </div>
      ) : (
        <>
          <p
            className={`mt-3 text-[26px] font-semibold leading-none tracking-tight ${
              value === '—' ? 'text-slate-300' : 'text-[#0E0D17]'
            }`}
          >
            {value}
          </p>
          {delta && delta.pct !== null ? (
            <p
              className={`mt-2 flex items-center gap-1 text-[12px] font-medium ${
                up ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {up ? (
                <TrendingUp className="h-3 w-3" aria-hidden />
              ) : (
                <TrendingDown className="h-3 w-3" aria-hidden />
              )}
              {delta.label}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-slate-400">{emptyHint ?? 'Sin período anterior para comparar'}</p>
          )}
        </>
      )}
    </div>
  )
}
