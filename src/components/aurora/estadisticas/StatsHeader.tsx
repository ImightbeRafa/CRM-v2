'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarRange, ChevronDown, Download } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { AuroraTopActions } from '@/components/aurora/shell/AuroraTopActions'
import {
  AURORA_PERIOD_LABELS,
  CUSTOM_MAX_DAYS,
  formatRangeLabel,
  resolveAuroraPeriodSpec,
  type AuroraDateRange,
  type AuroraPeriod,
  type AuroraPeriodSpec,
} from '@/lib/statistics-aurora'

/** Always-visible chips; the rest (ayer, últimos N días, personalizado) live under "Más". */
const QUICK: AuroraPeriod[] = ['hoy', 'semana', 'semana-pasada', 'mes', 'mes-pasado']
const MORE: AuroraPeriod[] = ['ayer', '7d', '30d', '90d']

const chip = (active: boolean) =>
  `min-h-[36px] shrink-0 snap-start whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors ${
    active ? 'bg-white text-au-ink-0e0d17 shadow-sm' : 'text-slate-500 hover:text-slate-800'
  }`

/**
 * Period control (Costa Rica time, weeks start on Monday): quick chips for the calendar periods,
 * "Más" for ayer / últimos 7-30-90 días and a custom range with two dates.
 */
export function PeriodPicker({
  spec,
  range,
  onChange,
}: {
  spec: AuroraPeriodSpec
  range: AuroraDateRange | null
  onChange: (next: AuroraPeriodSpec) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(spec.from ?? range?.startDate ?? '')
  const [to, setTo] = useState(spec.to ?? range?.endDate ?? '')
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Opening the panel starts the custom dates from what is on screen.
  useEffect(() => {
    if (!open) return
    setFrom(spec.from ?? range?.startDate ?? '')
    setTo(spec.to ?? range?.endDate ?? '')
    setError(null)
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pick = (period: AuroraPeriod) => {
    onChange({ period })
    setOpen(false)
  }

  const applyCustom = () => {
    const next = resolveAuroraPeriodSpec('custom', from, to)
    if (!next) {
      setError(
        !from || !to
          ? 'Elegí las dos fechas.'
          : from > to
            ? 'La fecha "Desde" tiene que ser antes de "Hasta".'
            : `Máximo ${CUSTOM_MAX_DAYS} días.`,
      )
      return
    }
    onChange(next)
    setOpen(false)
  }

  const inMore = MORE.includes(spec.period) || spec.period === 'custom'
  const rangeText = range ? formatRangeLabel(range.startDate, range.endDate) : ''

  return (
    <div className="relative min-w-0" ref={boxRef}>
      <div
        role="tablist"
        aria-label="Período"
        data-testid="stats-period"
        className="flex min-w-0 max-w-full snap-x gap-0.5 overflow-x-auto rounded-xl bg-slate-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {QUICK.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={p === spec.period} onClick={() => pick(p)} className={chip(p === spec.period)}>
            {AURORA_PERIOD_LABELS[p]}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={inMore}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
          data-testid="stats-period-more"
          className={`${chip(inMore)} inline-flex items-center gap-1`}
        >
          <CalendarRange className="h-3.5 w-3.5" aria-hidden />
          {inMore ? AURORA_PERIOD_LABELS[spec.period] : 'Más'}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {rangeText ? (
        <p className="mt-1 px-1 text-[11.5px] text-slate-500" data-testid="stats-period-range">
          {rangeText} · hora de Costa Rica
        </p>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Elegir período"
          data-testid="stats-period-panel"
          className="absolute left-0 z-30 mt-2 w-[min(320px,calc(100vw-32px))] rounded-2xl bg-white p-3 shadow-lg ring-1 ring-slate-200 md:left-auto md:right-0"
        >
          <p className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Rápido</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {MORE.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pick(p)}
                className={`rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium ${
                  p === spec.period ? 'bg-au-tint-eef0ff text-au-ink-4a46e5' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {AURORA_PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <p className="mt-3 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Personalizado</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-500">
              Desde
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-900"
              />
            </label>
            <label className="text-[11px] text-slate-500">
              Hasta
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-900"
              />
            </label>
          </div>
          {from && to && from <= to ? (
            <p className="mt-1.5 px-1 text-[11px] text-slate-500">{formatRangeLabel(from, to)}</p>
          ) : null}
          {error ? <p className="mt-1.5 px-1 text-[11px] text-red-600">{error}</p> : null}
          <button
            type="button"
            onClick={applyCustom}
            data-testid="stats-period-apply"
            className="mt-2.5 w-full rounded-lg bg-[#5B6CFF] px-3 py-2 text-[12.5px] font-semibold text-white hover:opacity-95"
          >
            Ver este período
          </button>
          <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-slate-400">
            Hora de Costa Rica; las semanas van de lunes a domingo. Cada número se compara con el período anterior
            equivalente.
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Title + subtitle, period control and Exportar (links to the existing /exports page, only for
 * users who can view sales). No "Marca" filter: there is no brand model.
 */
export function StatsHeader({
  spec,
  range,
  onPeriod,
}: {
  spec: AuroraPeriodSpec
  range: AuroraDateRange | null
  onPeriod: (next: AuroraPeriodSpec) => void
}) {
  const { data: session } = useSession()
  const canExport = hasSessionPermission(session, 'view_sales')
  return (
    <header
      data-testid="stats-header"
      className="flex shrink-0 flex-col gap-3 border-b border-slate-200/70 bg-white px-4 py-3 md:flex-row md:items-start md:justify-between md:px-8"
    >
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold leading-tight text-au-ink-0e0d17">Estadísticas</h1>
        <p className="text-[12px] text-slate-400">Ventas, conversación y rendimiento por línea</p>
      </div>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1 md:flex-none">
          <PeriodPicker spec={spec} range={range} onChange={onPeriod} />
        </div>
        {canExport ? (
          <Link
            href="/exports"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-au-ink-0e0d17 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Exportar</span>
            <span className="sr-only sm:hidden">Exportar</span>
          </Link>
        ) : null}
        <AuroraTopActions />
      </div>
    </header>
  )
}
