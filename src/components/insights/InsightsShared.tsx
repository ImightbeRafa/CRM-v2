'use client'

/**
 * "Know what sells" (Lane E2) · shared UI for the Estadísticas sub-pages (Anuncios, Equipo, Clientes):
 * the period in the URL (same ?periodo= / ?desde= / ?hasta= as the main page), a JSON loader with
 * retry, the header with the page tabs, and the "fuente · período" line every number carries.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange, Database, HeartHandshake, LayoutGrid, Megaphone, Users } from 'lucide-react'
import { AuroraTopActions } from '@/components/aurora/shell/AuroraTopActions'
import { PeriodPicker } from '@/components/aurora/estadisticas/StatsHeader'
import type { CardLoad } from '@/components/aurora/estadisticas/StatsCard'
import {
  auroraPeriodRange,
  DEFAULT_AURORA_PERIOD,
  formatRangeLabel,
  normalizeAuroraPeriod,
  resolveAuroraPeriodSpec,
  type AuroraDateRange,
  type AuroraPeriodSpec,
} from '@/lib/statistics-aurora'

export const INSIGHT_TABS = [
  { href: '/estadisticas', label: 'Resumen', icon: LayoutGrid },
  { href: '/estadisticas/anuncios', label: 'Anuncios', icon: Megaphone },
  { href: '/estadisticas/equipo', label: 'Equipo y chats', icon: Users },
  { href: '/estadisticas/clientes', label: 'Clientes', icon: HeartHandshake },
] as const

export type Loaded<T> = { state: CardLoad; data: T | null; status: number | null }

export function useInsightsJson<T>(url: string | null): [Loaded<T>, () => void] {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading', data: null, status: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setResult({ state: 'loading', data: null, status: null })
    fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          setResult({ state: 'error', data: null, status: res.status })
          return
        }
        setResult({ state: 'ready', data: (await res.json()) as T, status: res.status })
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setResult({ state: 'error', data: null, status: null })
      })
    return () => controller.abort()
  }, [url, nonce])
  return [result, useCallback(() => setNonce((n) => n + 1), [])]
}

/** Period from the URL; same default as the Resumen, so moving between tabs keeps the same numbers' period. */
export function useUrlPeriod(defaultPeriod: AuroraPeriodSpec['period'] = DEFAULT_AURORA_PERIOD) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const spec = useMemo<AuroraPeriodSpec>(() => {
    const raw = searchParams.get('periodo')
    if (!raw) return { period: defaultPeriod }
    return resolveAuroraPeriodSpec(raw, searchParams.get('desde'), searchParams.get('hasta')) ?? {
      period: normalizeAuroraPeriod(raw) === 'custom' ? defaultPeriod : normalizeAuroraPeriod(raw),
    }
  }, [searchParams, defaultPeriod])

  const setSpec = useCallback(
    (next: AuroraPeriodSpec) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('periodo', next.period)
      if (next.period === 'custom' && next.from && next.to) {
        params.set('desde', next.from)
        params.set('hasta', next.to)
      } else {
        params.delete('desde')
        params.delete('hasta')
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // Costa Rica day boundary, evaluated in the browser after mount (same as the main page).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const range = useMemo<AuroraDateRange | null>(() => (mounted ? auroraPeriodRange(spec) : null), [mounted, spec])
  const query =
    spec.period === 'custom' && spec.from && spec.to ? `period=custom&from=${spec.from}&to=${spec.to}` : `period=${spec.period}`
  return { spec, setSpec, range, query }
}

/** Keeps ?periodo… when moving between the tabs. */
function tabHref(href: string, search: string): string {
  const params = new URLSearchParams(search)
  const keep = new URLSearchParams()
  for (const key of ['periodo', 'desde', 'hasta']) {
    const v = params.get(key)
    if (v) keep.set(key, v)
  }
  const q = keep.toString()
  return q ? `${href}?${q}` : href
}

export function InsightsTabs({ className = '' }: { className?: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  return (
    <nav
      aria-label="Secciones de estadísticas"
      data-testid="insights-tabs"
      className={`-mx-1 flex snap-x gap-1 overflow-x-auto px-1 [scrollbar-width:none] ${className}`}
    >
      {INSIGHT_TABS.map((tab) => {
        const active = pathname === tab.href
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tabHref(tab.href, searchParams.toString())}
            aria-current={active ? 'page' : undefined}
            className={`relative inline-flex min-h-[40px] shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors ${
              active
                ? 'text-au-ink-5b6cff after:absolute after:inset-x-2 after:-bottom-2 after:h-[2px] after:rounded-full after:bg-[#5B6CFF]'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function InsightsHeader({
  title,
  subtitle,
  spec,
  range,
  onPeriod,
}: {
  title: string
  subtitle: string
  spec?: AuroraPeriodSpec
  range?: AuroraDateRange | null
  onPeriod?: (next: AuroraPeriodSpec) => void
}) {
  return (
    <header data-testid="insights-header" className="shrink-0 border-b border-slate-200/70 bg-white px-4 pt-3 md:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold leading-tight text-au-ink-0e0d17">{title}</h1>
          <p className="text-[12px] text-slate-400">{subtitle}</p>
        </div>
        <div className="flex min-w-0 items-start gap-2">
          {spec && onPeriod ? (
            <div className="min-w-0 flex-1 md:flex-none">
              <PeriodPicker spec={spec} range={range ?? null} onChange={onPeriod} />
            </div>
          ) : null}
          <AuroraTopActions />
        </div>
      </div>
      <InsightsTabs className="mt-3 pb-2" />
    </header>
  )
}

/** "Fuente: … · 1–30 oct" — every number says where it comes from and for which period. */
export function SourceNote({ children, range }: { children: ReactNode; range?: AuroraDateRange | null }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-[11px] leading-relaxed text-slate-400" data-testid="insights-source">
      {range ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
          <CalendarRange className="h-3 w-3" aria-hidden />
          {formatRangeLabel(range.startDate, range.endDate)}
        </span>
      ) : null}
      <p className="min-w-0 flex-1">
        <Database className="mr-1 inline h-3 w-3 -translate-y-px" aria-hidden />
        <span className="font-medium text-slate-500">Fuente:</span> {children}
      </p>
    </div>
  )
}

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5">
      <dt className="text-[11px] leading-tight text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-au-ink-0e0d17">{value}</dd>
      {hint ? <p className="mt-0.5 text-[10.5px] leading-tight text-slate-400">{hint}</p> : null}
    </div>
  )
}

export const nf = new Intl.NumberFormat('es-CR')

/**
 * Page body for every Estadísticas tab: the full content width (same side padding as the headers), capped
 * only on very wide screens (≥ ~1960 px of content) so lines and tables never stretch absurdly. Left-aligned
 * (no mx-auto) so the body always lines up with the header and tabs above it.
 */
export const STATS_CONTAINER = 'w-full max-w-[1760px] space-y-4 px-4 pb-8 pt-5 md:px-8'

/** Main chart + side card: side card fixed on laptops, a third of the width on wide screens. */
export const STATS_SPLIT = 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
