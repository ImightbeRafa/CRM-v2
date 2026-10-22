/**
 * "Know what sells" (Lane E2) · small numeric helpers shared by the insight reports.
 * Pure: no DB, no React. Every function returns finite numbers or null (never NaN / Infinity).
 */

/** Nearest-rank percentile (p in 0..1) of finite values; null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const q = Math.min(1, Math.max(0, p))
  const rank = Math.max(1, Math.ceil(q * clean.length))
  return clean[rank - 1]
}

export function median(values: readonly number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2
}

/** part / total, or null when total is 0 (so the UI shows "—", not 0 %). */
export function rate(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null
  return part / total
}

/** Money stored as Float: anything not finite or negative counts as 0. */
export function money(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** "4 min", "1 h 05 min", "2 d 3 h", "45 s" — plain Spanish for a duration in ms. */
export function formatDurationEs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')} min`
  const d = Math.floor(h / 24)
  return `${d} d ${h % 24} h`
}

/** 0.4567 → "46 %"; null → "—". */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)} %`
}
