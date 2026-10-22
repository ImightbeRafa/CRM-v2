/**
 * AI spend periods: Costa Rica calendar months. Costa Rica is UTC-6 all year (no DST), so a month starts at 06:00 UTC
 * on the 1st. Pure (no server-only): used by the live allowance gate and its tests.
 */

const CR_OFFSET_HOURS = 6

/** "2026-10" for the Costa Rica month that contains `now`. */
export function costaRicaPeriodKey(now: Date): string {
  const cr = new Date(now.getTime() - CR_OFFSET_HOURS * 3_600_000)
  return `${cr.getUTCFullYear()}-${String(cr.getUTCMonth() + 1).padStart(2, '0')}`
}

/** UTC instant the Costa Rica month containing `now` started (index-friendly lower bound for AiUsageEvent.createdAt). */
export function costaRicaMonthStartUtc(now: Date): Date {
  const cr = new Date(now.getTime() - CR_OFFSET_HOURS * 3_600_000)
  return new Date(Date.UTC(cr.getUTCFullYear(), cr.getUTCMonth(), 1, CR_OFFSET_HOURS))
}

/** UTC instant the next Costa Rica month starts (when a monthly allowance renews). */
export function nextCostaRicaMonthStartUtc(now: Date): Date {
  const cr = new Date(now.getTime() - CR_OFFSET_HOURS * 3_600_000)
  return new Date(Date.UTC(cr.getUTCFullYear(), cr.getUTCMonth() + 1, 1, CR_OFFSET_HOURS))
}
