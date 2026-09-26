'use client'

import Link from 'next/link'
import { Download } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { AURORA_PERIODS, AURORA_PERIOD_LABELS, type AuroraPeriod } from '@/lib/statistics-aurora'

export function PeriodSegmented({
  value,
  onChange,
}: {
  value: AuroraPeriod
  onChange: (p: AuroraPeriod) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Período"
      data-testid="stats-period"
      className="flex max-w-full snap-x gap-0.5 overflow-x-auto rounded-xl bg-slate-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {AURORA_PERIODS.map((p) => {
        const active = p === value
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p)}
            className={`min-h-[36px] shrink-0 snap-start whitespace-nowrap rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
              active ? 'bg-white text-[#0E0D17] shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {AURORA_PERIOD_LABELS[p]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Title + subtitle, period control and Exportar (links to the existing /exports page, only for
 * users who can view sales). No "Marca" filter: there is no brand model.
 */
export function StatsHeader({ period, onPeriod }: { period: AuroraPeriod; onPeriod: (p: AuroraPeriod) => void }) {
  const { data: session } = useSession()
  const canExport = hasSessionPermission(session, 'view_sales')
  return (
    <header
      data-testid="stats-header"
      className="flex shrink-0 flex-col gap-3 border-b border-slate-200/70 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between md:px-8"
    >
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold leading-tight text-[#0E0D17]">Estadísticas</h1>
        <p className="text-[12px] text-slate-400">Ventas, conversación y rendimiento por línea</p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 md:flex-none">
          <PeriodSegmented value={period} onChange={onPeriod} />
        </div>
        {canExport ? (
          <Link
            href="/exports"
            className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-[#0E0D17] hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Exportar</span>
            <span className="sr-only sm:hidden">Exportar</span>
          </Link>
        ) : null}
      </div>
    </header>
  )
}
