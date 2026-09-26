/**
 * Aurora Estadísticas · pure period / delta / formatting helpers (client + server safe).
 * Only depends on the Costa Rica date helpers; no DB, no React.
 */

import {
  addDaysToStatsDateKey,
  getCurrentStatsDateKey,
  getPreviousStatsPeriod,
} from '@/lib/statistics-dates'

export const AURORA_PERIODS = ['hoy', '7d', '30d', '90d'] as const
export type AuroraPeriod = (typeof AURORA_PERIODS)[number]

export const DEFAULT_AURORA_PERIOD: AuroraPeriod = '7d'

export const AURORA_PERIOD_LABELS: Record<AuroraPeriod, string> = {
  hoy: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  '90d': '90 días',
}

const PERIOD_DAYS: Record<AuroraPeriod, number> = { hoy: 1, '7d': 7, '30d': 30, '90d': 90 }

export type AuroraDateRange = { startDate: string; endDate: string }

/** Known period → itself; anything else → null (callers decide: 400 on the API, default in the UI). */
export function resolveAuroraPeriod(raw: unknown): AuroraPeriod | null {
  return typeof raw === 'string' && (AURORA_PERIODS as readonly string[]).includes(raw)
    ? (raw as AuroraPeriod)
    : null
}

/** UI variant: unknown / missing → default period. */
export function normalizeAuroraPeriod(raw: unknown): AuroraPeriod {
  return resolveAuroraPeriod(raw) ?? DEFAULT_AURORA_PERIOD
}

export function auroraPeriodDays(period: AuroraPeriod): number {
  return PERIOD_DAYS[period]
}

/** Inclusive range ending today (Costa Rica time): hoy = [t,t], 7d = [t-6,t], … */
export function auroraPeriodRange(period: AuroraPeriod, now: Date = new Date()): AuroraDateRange {
  const endDate = getCurrentStatsDateKey(now)
  const days = PERIOD_DAYS[period]
  return { startDate: addDaysToStatsDateKey(endDate, -(days - 1)), endDate }
}

/** Adjacent range of the same length immediately before `range`. */
export function auroraPreviousRange(range: AuroraDateRange): AuroraDateRange {
  const prev = getPreviousStatsPeriod(range.startDate, range.endDate)
  if (prev) return prev
  return { startDate: range.startDate, endDate: range.endDate }
}

/** Every date key in [startDate, endDate], inclusive. Capped to protect against bad input. */
export function enumerateDateKeys(startDate: string, endDate: string, max = 400): string[] {
  const keys: string[] = []
  let cursor = startDate
  while (cursor <= endDate && keys.length < max) {
    keys.push(cursor)
    const next = addDaysToStatsDateKey(cursor, 1)
    if (next === cursor) break
    cursor = next
  }
  return keys
}

/** Percent change; `null` when it is not meaningful (no previous base or non-finite input). */
export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function safeCount(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0
}

export function safeAmount(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

/** Average ticket; 0 orders → 0 (never NaN / Infinity). */
export function averageTicket(revenue: number, orders: number): number {
  const o = safeCount(orders)
  return o > 0 ? safeAmount(revenue) / o : 0
}

/** "+18%", "−3%", "0%"; `null` → "—". */
export function formatDeltaLabel(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const rounded = Math.round(pct)
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`
}

export function periodCompareLabel(period: AuroraPeriod): string {
  switch (period) {
    case 'hoy':
      return 'vs ayer'
    case '7d':
      return 'vs 7 días anteriores'
    case '30d':
      return 'vs 30 días anteriores'
    case '90d':
      return 'vs 90 días anteriores'
  }
}

function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Exact amount with dot grouping ("₡13.340"). Non-finite → `${symbol}0`. */
export function formatExactMoney(value: number, symbol: string): string {
  const v = safeAmount(value)
  return `${v < 0 ? '−' : ''}${symbol}${groupThousands(Math.abs(v))}`
}

/**
 * Compact amount as in STAT-01: "₡2,48 M", "₡455 mil", "₡13.340".
 * Non-finite → `${symbol}0`.
 */
export function formatCompactMoney(value: number, symbol: string): string {
  const v = safeAmount(value)
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1_000_000) {
    const millions = (Math.round((abs / 1_000_000) * 100) / 100).toFixed(2).replace('.', ',')
    return `${sign}${symbol}${millions} M`
  }
  if (abs >= 100_000) return `${sign}${symbol}${Math.round(abs / 1000)} mil`
  return `${sign}${symbol}${groupThousands(abs)}`
}

export type DailyPoint = { date: string; revenue: number; orderCount: number }
export type PairedDailyPoint = {
  date: string
  prevDate: string
  revenue: number
  orderCount: number
  prevRevenue: number
}

/** Zero-filled series: index i pairs day i of the current range with day i of the previous range. */
export function pairDailySeries(
  current: DailyPoint[],
  previous: DailyPoint[],
  range: AuroraDateRange,
  prevRange: AuroraDateRange,
): PairedDailyPoint[] {
  const curByDate = new Map(current.map((d) => [d.date, d]))
  const prevByDate = new Map(previous.map((d) => [d.date, d]))
  const curKeys = enumerateDateKeys(range.startDate, range.endDate)
  const prevKeys = enumerateDateKeys(prevRange.startDate, prevRange.endDate)
  return curKeys.map((date, i) => {
    const prevDate = prevKeys[i] ?? ''
    const c = curByDate.get(date)
    const p = prevDate ? prevByDate.get(prevDate) : undefined
    return {
      date,
      prevDate,
      revenue: safeAmount(c?.revenue),
      orderCount: safeCount(c?.orderCount),
      prevRevenue: safeAmount(p?.revenue),
    }
  })
}

const WEEKDAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function parseKey(dateKey: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** "Dom" for short ranges, "26 sep" for long ones. Invalid key → "". */
export function formatDayLabel(dateKey: string, style: 'weekday' | 'short' = 'short'): string {
  const p = parseKey(dateKey)
  if (!p || p.m < 1 || p.m > 12) return ''
  if (style === 'weekday') return WEEKDAYS_ES[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()] ?? ''
  return `${p.d} ${MONTHS_ES[p.m - 1]}`
}

/** "20–26 sep", "26 sep", "28 ago – 26 sep". */
export function formatRangeLabel(startDate: string, endDate: string): string {
  const s = parseKey(startDate)
  const e = parseKey(endDate)
  if (!s || !e || s.m < 1 || s.m > 12 || e.m < 1 || e.m > 12) return ''
  if (startDate === endDate) return `${e.d} ${MONTHS_ES[e.m - 1]}`
  if (s.m === e.m && s.y === e.y) return `${s.d}–${e.d} ${MONTHS_ES[e.m - 1]}`
  return `${s.d} ${MONTHS_ES[s.m - 1]} – ${e.d} ${MONTHS_ES[e.m - 1]}`
}

/** Bar height as a percentage of `max`, clamped 0–100 (0 when max ≤ 0). */
export function barPercent(value: number, max: number): number {
  const v = safeAmount(value)
  const m = safeAmount(max)
  if (m <= 0 || v <= 0) return 0
  return Math.min(100, (v / m) * 100)
}

/** Share of `part` in `total` as a whole percent; 0 total → 0. */
export function sharePercent(part: number, total: number): number {
  const t = safeCount(total)
  if (t <= 0) return 0
  return Math.round((safeCount(part) / t) * 100)
}

/** Chart density: ≤31 days stay daily; longer ranges are summed per week so bars stay legible. */
export function chartBucketSize(dayCount: number): number {
  return dayCount > 31 ? 7 : 1
}

/** Sums consecutive points into buckets of `size`; the bucket is labelled by its first day. */
export function bucketPairedSeries(series: PairedDailyPoint[], size: number): PairedDailyPoint[] {
  if (size <= 1) return series
  const out: PairedDailyPoint[] = []
  for (let i = 0; i < series.length; i += size) {
    const slice = series.slice(i, i + size)
    out.push({
      date: slice[0].date,
      prevDate: slice[0].prevDate,
      revenue: slice.reduce((a, p) => a + p.revenue, 0),
      orderCount: slice.reduce((a, p) => a + p.orderCount, 0),
      prevRevenue: slice.reduce((a, p) => a + p.prevRevenue, 0),
    })
  }
  return out
}
