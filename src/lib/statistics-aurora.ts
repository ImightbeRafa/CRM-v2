/**
 * Aurora Estadísticas · pure period / delta / formatting helpers (client + server safe).
 * Only depends on the Costa Rica date helpers and the pure payment-state rules; no DB, no React.
 */

import { isCollectedRevenue } from '@/lib/order-payment-status'
import {
  addDaysToStatsDateKey,
  getCurrentStatsDateKey,
  getPreviousStatsPeriod,
} from '@/lib/statistics-dates'

/**
 * Periods, all in Costa Rica time (weeks start on Monday):
 * - calendar: hoy, ayer, semana (Monday → today), semana-pasada (Mon–Sun), mes (1st → today), mes-pasado
 * - rolling: 7d / 30d / 90d (ending today)
 * - custom: `from` / `to` date keys (YYYY-MM-DD), max CUSTOM_MAX_DAYS days
 */
export const AURORA_PERIODS = ['hoy', 'ayer', 'semana', 'semana-pasada', 'mes', 'mes-pasado', '7d', '30d', '90d', 'custom'] as const
export type AuroraPeriod = (typeof AURORA_PERIODS)[number]

export const DEFAULT_AURORA_PERIOD: AuroraPeriod = '7d'
export const CUSTOM_MAX_DAYS = 366

export const AURORA_PERIOD_LABELS: Record<AuroraPeriod, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  semana: 'Esta semana',
  'semana-pasada': 'Semana pasada',
  mes: 'Este mes',
  'mes-pasado': 'Mes pasado',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  custom: 'Personalizado',
}

/** Picker groups (the order shown to the user). */
export const AURORA_PERIOD_GROUPS: Array<{ label: string; periods: AuroraPeriod[] }> = [
  { label: 'Calendario', periods: ['hoy', 'ayer', 'semana', 'semana-pasada', 'mes', 'mes-pasado'] },
  { label: 'Últimos días', periods: ['7d', '30d', '90d'] },
]

const ROLLING_DAYS: Partial<Record<AuroraPeriod, number>> = { '7d': 7, '30d': 30, '90d': 90 }

export type AuroraDateRange = { startDate: string; endDate: string }

/** A period plus, for `custom`, its dates. */
export type AuroraPeriodSpec = { period: AuroraPeriod; from?: string; to?: string }

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function isRealDateKey(key: unknown): key is string {
  if (typeof key !== 'string' || !DATE_KEY.test(key)) return false
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function dayCount(range: AuroraDateRange): number {
  return Math.round((Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * Validates a period (+ custom dates). Unknown period, or a custom range that is malformed,
 * reversed or longer than CUSTOM_MAX_DAYS → null.
 */
export function resolveAuroraPeriodSpec(period: unknown, from?: unknown, to?: unknown): AuroraPeriodSpec | null {
  const p = resolveAuroraPeriod(period)
  if (!p) return null
  if (p !== 'custom') return { period: p }
  if (!isRealDateKey(from) || !isRealDateKey(to) || from > to) return null
  if (dayCount({ startDate: from, endDate: to }) > CUSTOM_MAX_DAYS) return null
  return { period: 'custom', from, to }
}

/** Monday = 0 … Sunday = 6 for a date key. */
function weekdayMonday0(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

function monthStart(dateKey: string): string {
  return `${dateKey.slice(0, 8)}01`
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Same day-of-month span in the previous month (clamped: 31 mar → 28/29 feb). */
function shiftMonthBack(range: AuroraDateRange): AuroraDateRange {
  const [y, m] = range.startDate.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const last = lastDayOfMonth(py, pm)
  const key = (day: number) => `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
  return { startDate: key(Number(range.startDate.slice(8))), endDate: key(Number(range.endDate.slice(8))) }
}

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

function toSpec(spec: AuroraPeriod | AuroraPeriodSpec): AuroraPeriodSpec {
  return typeof spec === 'string' ? { period: spec } : spec
}

/** Days in the period's range (custom needs its dates). */
export function auroraPeriodDays(spec: AuroraPeriod | AuroraPeriodSpec, now: Date = new Date()): number {
  return dayCount(auroraPeriodRange(spec, now))
}

/**
 * Inclusive range in Costa Rica time: hoy = [t,t], 7d = [t-6,t], semana = [lunes,t],
 * semana-pasada = lunes–domingo anterior, mes = [día 1,t], mes-pasado = mes calendario anterior.
 * A `custom` spec without valid dates falls back to the default period.
 */
export function auroraPeriodRange(spec: AuroraPeriod | AuroraPeriodSpec, now: Date = new Date()): AuroraDateRange {
  const { period, from, to } = toSpec(spec)
  const today = getCurrentStatsDateKey(now)
  switch (period) {
    case 'hoy':
      return { startDate: today, endDate: today }
    case 'ayer': {
      const y = addDaysToStatsDateKey(today, -1)
      return { startDate: y, endDate: y }
    }
    case 'semana':
      return { startDate: addDaysToStatsDateKey(today, -weekdayMonday0(today)), endDate: today }
    case 'semana-pasada': {
      const monday = addDaysToStatsDateKey(today, -weekdayMonday0(today) - 7)
      return { startDate: monday, endDate: addDaysToStatsDateKey(monday, 6) }
    }
    case 'mes':
      return { startDate: monthStart(today), endDate: today }
    case 'mes-pasado': {
      const end = addDaysToStatsDateKey(monthStart(today), -1)
      return { startDate: monthStart(end), endDate: end }
    }
    case 'custom':
      if (isRealDateKey(from) && isRealDateKey(to) && from <= to) return { startDate: from, endDate: to }
      return auroraPeriodRange(DEFAULT_AURORA_PERIOD, now)
    default: {
      const days = ROLLING_DAYS[period] ?? 7
      return { startDate: addDaysToStatsDateKey(today, -(days - 1)), endDate: today }
    }
  }
}

/** Adjacent range of the same length immediately before `range`. */
export function auroraPreviousRange(range: AuroraDateRange): AuroraDateRange {
  const prev = getPreviousStatsPeriod(range.startDate, range.endDate)
  if (prev) return prev
  return { startDate: range.startDate, endDate: range.endDate }
}

/**
 * The comparison range: weeks compare with the same weekdays a week earlier, months with the
 * same days of the previous month (a partial "este mes" is never compared with a full month);
 * everything else with the adjacent range of the same length.
 */
export function auroraComparisonRange(spec: AuroraPeriod | AuroraPeriodSpec, range: AuroraDateRange): AuroraDateRange {
  const { period } = toSpec(spec)
  if (period === 'semana' || period === 'semana-pasada') {
    return { startDate: addDaysToStatsDateKey(range.startDate, -7), endDate: addDaysToStatsDateKey(range.endDate, -7) }
  }
  if (period === 'mes') return shiftMonthBack(range)
  if (period === 'mes-pasado') {
    const end = addDaysToStatsDateKey(range.startDate, -1)
    return { startDate: monthStart(end), endDate: end }
  }
  return auroraPreviousRange(range)
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

export function periodCompareLabel(spec: AuroraPeriod | AuroraPeriodSpec): string {
  const { period } = toSpec(spec)
  switch (period) {
    case 'hoy':
      return 'vs ayer'
    case 'ayer':
      return 'vs anteayer'
    case 'semana':
      return 'vs mismos días de la semana pasada'
    case 'semana-pasada':
      return 'vs la semana anterior'
    case 'mes':
      return 'vs mismos días del mes pasado'
    case 'mes-pasado':
      return 'vs el mes anterior'
    case '7d':
      return 'vs 7 días anteriores'
    case '30d':
      return 'vs 30 días anteriores'
    case '90d':
      return 'vs 90 días anteriores'
    case 'custom': {
      const days = spec && typeof spec === 'object' && spec.from && spec.to ? dayCount({ startDate: spec.from, endDate: spec.to }) : 0
      return days === 1 ? 'vs el día anterior' : days > 1 ? `vs ${days} días anteriores` : 'vs período anterior'
    }
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

/** "20–26 sep", "26 sep", "28 ago – 26 sep"; across years: "28 dic 2025 – 3 ene 2026". */
export function formatRangeLabel(startDate: string, endDate: string): string {
  const s = parseKey(startDate)
  const e = parseKey(endDate)
  if (!s || !e || s.m < 1 || s.m > 12 || e.m < 1 || e.m > 12) return ''
  if (startDate === endDate) return `${e.d} ${MONTHS_ES[e.m - 1]}`
  if (s.y !== e.y) return `${s.d} ${MONTHS_ES[s.m - 1]} ${s.y} – ${e.d} ${MONTHS_ES[e.m - 1]} ${e.y}`
  if (s.m === e.m) return `${s.d}–${e.d} ${MONTHS_ES[e.m - 1]}`
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

/**
 * Indices of the x-axis labels to show: at most `max`, evenly spaced, always including the
 * first and last point (no per-column truncation needed).
 */
export function evenTickIndices(count: number, max: number): number[] {
  const n = Math.max(0, Math.floor(count))
  const m = Math.max(1, Math.floor(max))
  if (n === 0) return []
  if (n <= m) return Array.from({ length: n }, (_, i) => i)
  if (m === 1) return [0]
  const out = new Set<number>()
  for (let i = 0; i < m; i++) out.add(Math.round((i * (n - 1)) / (m - 1)))
  return [...out].sort((a, b) => a - b)
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

export type ChatOrderLinkRow = { orderId: string | null; socialAccountId: string }
export type LinkedOrderFacts = Parameters<typeof isCollectedRevenue>[0] & { total: number | null }
export type ChatOrderLinkSummary = {
  linkedOrders: number
  perLine: Map<string, { orders: number; revenue: number }>
}

/**
 * Orders that came from a chat (ChatMessage.orderId), overall and per line.
 * Each order counts once (first link wins); links whose order is outside `ordersById`
 * (other period) are ignored. Revenue follows the summary's booked / collected rule.
 */
export function summarizeChatOrderLinks(
  links: ChatOrderLinkRow[],
  ordersById: Map<string, LinkedOrderFacts>,
  collectedMode: boolean,
): ChatOrderLinkSummary {
  const seen = new Set<string>()
  const perLine = new Map<string, { orders: number; revenue: number }>()
  for (const link of links) {
    if (!link.orderId || seen.has(link.orderId)) continue
    const order = ordersById.get(link.orderId)
    if (!order) continue
    seen.add(link.orderId)
    const total = safeAmount(order.total)
    const counted = collectedMode ? (isCollectedRevenue(order) ? total : 0) : total
    const line = perLine.get(link.socialAccountId) ?? { orders: 0, revenue: 0 }
    line.orders += 1
    line.revenue += counted
    perLine.set(link.socialAccountId, line)
  }
  return { linkedOrders: seen.size, perLine }
}
