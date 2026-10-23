'use client'

/**
 * "Know what sells" chart kit (Lane E2 polish). Plain SVG / CSS, no chart library.
 *
 * Colors: one categorical order, validated with the dataviz palette checks in both themes
 * (light vs #FCFCFB, dark vs the #16161F surface): brand indigo, emerald, amber, pink, plus a
 * neutral gray for "the rest". Marks use the series color through `currentColor`; text always
 * uses text tokens (slate), never the series color. Light green / amber are under 3:1 on white,
 * so every chart here keeps a legend and visible value labels.
 *
 * Mark specs: 2px lines, ~10% area wash, hairline solid grid, bars ≤ 10px with a 4px rounded
 * data end, 2px surface gaps between touching segments, hover/tap tooltip on every plot.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Info, XCircle, type LucideIcon } from 'lucide-react'
import { AuroraErrorState } from '@/components/aurora/states'
import { StatsSkeleton, type CardLoad } from '@/components/aurora/estadisticas/StatsCard'

export const SERIES = [
  'text-[#5B6CFF] dark:text-[#6E7BFF]',
  'text-[#10B981] dark:text-[#0EA472]',
  'text-[#F59E0B] dark:text-[#B97F08]',
  'text-[#EC4899] dark:text-[#E8559C]',
] as const
export const NEUTRAL_SERIES = 'text-[#94A3B8] dark:text-[#5C6478]'
/** Surface color (card background) for rings and gaps. */
const SURFACE = 'text-white dark:text-[#16161F]'

export function Swatch({ cls, shape = 'dot' }: { cls: string; shape?: 'dot' | 'line' }) {
  return (
    <span
      aria-hidden
      className={`${cls} inline-block shrink-0 bg-current ${shape === 'line' ? 'h-[3px] w-3 rounded-full' : 'h-2 w-2 rounded-full'}`}
    />
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────────────────────────

/** Premium card: icon chip + title + subtitle, optional controls, body, and a source footer. */
export function InsightCard({
  icon: Icon,
  title,
  subtitle,
  right,
  state = 'ready',
  onRetry,
  skeletonClass,
  footer,
  className = '',
  children,
  testId,
}: {
  icon?: LucideIcon
  title: string
  subtitle?: string
  right?: ReactNode
  state?: CardLoad
  onRetry?: () => void
  skeletonClass?: string
  footer?: ReactNode
  className?: string
  children?: ReactNode
  testId?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:p-5 ${className}`}
      aria-busy={state === 'loading'}
      data-testid={testId}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-au-tint-eef0ff text-au-ink-5b6cff" aria-hidden>
              <Icon className="h-[18px] w-[18px]" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-au-ink-0e0d17">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {state !== 'error' && right ? <div className="min-w-0 max-w-full">{right}</div> : null}
      </header>
      {state === 'loading' ? <StatsSkeleton className={skeletonClass} /> : null}
      {state === 'error' ? (
        <AuroraErrorState
          title="No pudimos cargar esta tarjeta"
          description="Revisá tu conexión e intentá de nuevo."
          onRetry={onRetry ?? (() => undefined)}
          className="py-8"
        />
      ) : null}
      {state === 'ready' ? children : null}
      {state === 'ready' && footer ? <div className="mt-4 border-t border-slate-100 pt-3">{footer}</div> : null}
    </section>
  )
}

/** Segmented control (period / channel / sort chips) that scrolls sideways on phones instead of wrapping. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: ReadonlyArray<{ key: T; label: string }>
  onChange: (key: T) => void
  label: string
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <div className="inline-flex gap-0.5 rounded-xl bg-slate-100 p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={value === o.key}
            onClick={() => onChange(o.key)}
            className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-[10px] px-3 text-[12px] font-medium transition-colors ${
              value === o.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Figures ──────────────────────────────────────────────────────────────────────────────────────

/** Stat tile: label · value (proportional figures) · hint. Optional accent icon and trend. */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'brand',
  trend,
}: {
  icon?: LucideIcon
  label: string
  value: string
  hint?: ReactNode
  tone?: 'brand' | 'green' | 'amber' | 'pink' | 'neutral'
  trend?: ReactNode
}) {
  const toneCls = {
    brand: 'bg-au-tint-eef0ff text-au-ink-5b6cff',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    pink: 'bg-pink-50 text-pink-600',
    neutral: 'bg-slate-100 text-slate-500',
  }[tone]
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3" data-testid="insight-tile">
      <div className="flex items-center gap-2">
        {Icon ? (
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${toneCls}`} aria-hidden>
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <dt className="min-w-0 text-[11.5px] font-medium leading-tight text-slate-500">{label}</dt>
      </div>
      <dd className="mt-2 text-[22px] font-semibold leading-none tracking-tight text-au-ink-0e0d17">{value}</dd>
      {hint ? <dd className="mt-1.5 text-[11px] leading-snug text-slate-400">{hint}</dd> : null}
      {trend ? <dd className="mt-2">{trend}</dd> : null}
    </div>
  )
}

export type ChipTone = 'good' | 'warning' | 'critical' | 'neutral' | 'info'

const CHIP: Record<ChipTone, { cls: string; icon: LucideIcon }> = {
  good: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70', icon: CheckCircle2 },
  warning: { cls: 'bg-amber-50 text-amber-700 ring-amber-200/70', icon: Clock },
  critical: { cls: 'bg-red-50 text-red-700 ring-red-200/70', icon: AlertTriangle },
  neutral: { cls: 'bg-slate-100 text-slate-600 ring-slate-200/70', icon: XCircle },
  info: { cls: 'bg-au-tint-eef0ff text-au-ink-5b6cff ring-[#5B6CFF]/15', icon: Info },
}

/** Status chip: color + icon + words (never color alone). `icon={null}` for a plain value chip. */
export function StatusChip({ tone, icon, children }: { tone: ChipTone; icon?: LucideIcon | null; children: ReactNode }) {
  const Icon = icon === null ? null : (icon ?? CHIP[tone].icon)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ring-1 ${CHIP[tone].cls}`}>
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  )
}

/** Meter: the filled part carries the state, the track is a lighter step of the same ramp. */
export function Meter({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'good' | 'warning' | 'critical'; label: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100
  const cls = {
    brand: ['bg-au-tint-eef0ff', 'bg-[#5B6CFF] dark:bg-[#6E7BFF]'],
    good: ['bg-emerald-100', 'bg-emerald-500'],
    warning: ['bg-amber-100', 'bg-amber-500'],
    critical: ['bg-red-100', 'bg-red-500'],
  }[tone]
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full ${cls[0]}`} role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${cls[1]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Composition ──────────────────────────────────────────────────────────────────────────────────

export type SplitPart = { key: string; label: string; value: number; display: string; cls: string }

/** One 100% bar split into parts with 2px surface gaps, plus a legend that carries the numbers. */
export function SplitBar({ parts, label, legend = true }: { parts: SplitPart[]; label: string; legend?: boolean }) {
  const total = parts.reduce((s, p) => s + (p.value > 0 ? p.value : 0), 0)
  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={label}>
        {total > 0
          ? parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <span key={p.key} className={`${p.cls} h-full bg-current first:rounded-l-full last:rounded-r-full`} style={{ width: `${Math.max(1.5, (p.value / total) * 100)}%` }} />
              ))
          : null}
      </div>
      {legend ? (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
              <Swatch cls={p.cls} />
              <span>{p.label}</span>
              <span className="font-semibold tabular-nums text-slate-800">{p.display}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export type BarRow = { key: string; label: ReactNode; sub?: ReactNode; value: number; display: string; cls?: string }

/** Ranked horizontal bars: label above, bar from a single baseline, value at the end in text ink. */
export function BarList({ rows, max, empty }: { rows: BarRow[]; max?: number; empty?: ReactNode }) {
  const top = max ?? rows.reduce((m, r) => Math.max(m, r.value), 0)
  if (rows.length === 0) return <>{empty ?? null}</>
  return (
    <ul className="space-y-3" data-testid="insight-bars">
      {rows.map((r) => (
        <li key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 text-[12.5px] text-slate-700">{r.label}</div>
            <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-slate-900">{r.display}</span>
          </div>
          {r.sub ? <div className="text-[11px] text-slate-400">{r.sub}</div> : null}
          <div className="mt-1.5 h-2 w-full rounded-r-[4px] bg-slate-100/70">
            <div
              className={`${r.cls ?? SERIES[0]} h-full rounded-r-[4px] bg-current`}
              style={{ width: `${top > 0 ? Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Area chart ───────────────────────────────────────────────────────────────────────────────────

export type AreaSeries = { key: string; label: string; cls: string; values: Array<number | null>; area?: boolean }

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.getBoundingClientRect().width)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Clean ceiling for the y axis (1, 2, 2.5, 5 × 10^n). */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(value)))
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * exp) return step * exp
  return 10 * exp
}

/**
 * Area / line chart over days. One y axis (hairline grid at 0 / ½ / max), 2px lines, a ~10% wash
 * under series with `area`, crosshair + tooltip on hover / tap, a legend for 2+ series and a hidden
 * table for screen readers. Null values break the line (no invented points).
 */
export function AreaChart({
  labels,
  tickLabel,
  series,
  format,
  axisFormat,
  height = 180,
  ariaLabel,
}: {
  labels: string[]
  tickLabel: (label: string) => string
  series: AreaSeries[]
  format: (value: number) => string
  axisFormat?: (value: number) => string
  height?: number
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const padL = 40
  const padR = 8
  const padT = 8
  const padB = 22
  const n = labels.length
  const maxVal = useMemo(
    () => niceMax(series.reduce((m, s) => Math.max(m, ...s.values.map((v) => (v == null || !Number.isFinite(v) ? 0 : v))), 0)),
    [series],
  )
  const innerW = Math.max(0, width - padL - padR)
  const innerH = height - padT - padB
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / maxVal) * innerH
  const ticks = [0, maxVal / 2, maxVal]
  const xTicks = n <= 1 ? [0] : n <= 4 ? labels.map((_, i) => i) : [0, Math.round((n - 1) / 2), n - 1]

  function paths(values: Array<number | null>) {
    const segments: Array<Array<[number, number]>> = []
    let cur: Array<[number, number]> = []
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        if (cur.length) segments.push(cur)
        cur = []
        return
      }
      cur.push([x(i), y(v)])
    })
    if (cur.length) segments.push(cur)
    const line = segments.map((seg) => seg.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')).join('')
    const base = y(0)
    const area = segments
      .filter((seg) => seg.length > 1)
      .map((seg) => `M${seg[0][0].toFixed(1)},${base}${seg.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('')}L${seg[seg.length - 1][0].toFixed(1)},${base}Z`)
      .join('')
    return { line, area, single: segments.filter((s) => s.length === 1).map((s) => s[0]) }
  }

  function pick(clientX: number) {
    const el = ref.current
    if (!el || n === 0) return
    const rel = clientX - el.getBoundingClientRect().left - padL
    const i = n <= 1 ? 0 : Math.round((rel / Math.max(1, innerW)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), 70), Math.max(70, width - 70)) : 0

  return (
    <div>
      {series.length > 1 ? (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
              <Swatch cls={s.cls} shape="line" /> {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={ref}
        className="relative w-full touch-pan-y select-none"
        style={{ height }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        data-testid="insight-area-chart"
      >
        {width > 0 ? (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
            <g className="text-slate-400">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.45 : 0.2} strokeWidth={1} shapeRendering="crispEdges" />
                  <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="currentColor" className="tabular-nums">
                    {(axisFormat ?? format)(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
                  fontSize={10}
                  fill="currentColor"
                >
                  {tickLabel(labels[i])}
                </text>
              ))}
            </g>
            {series.map((s) => {
              const p = paths(s.values)
              return (
                <g key={s.key} className={s.cls}>
                  {s.area !== false ? <path d={p.area} fill="currentColor" fillOpacity={0.1} /> : null}
                  <path d={p.line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {p.single.map(([px, py]) => (
                    <circle key={`${px}`} cx={px} cy={py} r={3} fill="currentColor" />
                  ))}
                </g>
              )
            })}
            {hover !== null ? (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} className="text-slate-400" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />
                {series.map((s) => {
                  const v = s.values[hover]
                  if (v == null || !Number.isFinite(v)) return null
                  return (
                    <g key={s.key}>
                      <circle cx={x(hover)} cy={y(v)} r={6} className={SURFACE} fill="currentColor" />
                      <circle cx={x(hover)} cy={y(v)} r={4} className={s.cls} fill="currentColor" />
                    </g>
                  )
                })}
              </g>
            ) : null}
          </svg>
        ) : null}
        {hover !== null && width > 0 ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0E0D17] px-2.5 py-1.5 text-[11px] text-white shadow-lg"
            style={{ left: tipLeft }}
          >
            <p className="font-semibold">{tickLabel(labels[hover])}</p>
            {series.map((s) => {
              const v = s.values[hover]
              return (
                <p key={s.key} className="mt-0.5 flex items-center gap-1.5">
                  <Swatch cls={s.cls} />
                  <span className="text-white/70">{s.label}</span>
                  <span className="ml-auto pl-2 font-semibold tabular-nums">{v == null ? '—' : format(v)}</span>
                </p>
              )
            })}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th>Día</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <td>{tickLabel(l)}</td>
              {series.map((s) => (
                <td key={s.key}>{s.values[i] == null ? '—' : format(s.values[i] as number)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
