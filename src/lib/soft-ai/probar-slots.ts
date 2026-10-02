/**
 * Concurrency guard for Probar model calls: at most a few in flight per business (per container). Together with the
 * per-user rate limit and the daily test budget it bounds how far a burst can overshoot the budget (the budget is
 * read before the call and written after it, so parallel calls could otherwise all pass the check).
 */
export const MAX_PROBAR_IN_FLIGHT_PER_TENANT = 3

const inFlight = new Map<string, number>()

export function acquireProbarSlot(tenantId: string): boolean {
  const n = inFlight.get(tenantId) ?? 0
  if (n >= MAX_PROBAR_IN_FLIGHT_PER_TENANT) return false
  inFlight.set(tenantId, n + 1)
  return true
}

export function releaseProbarSlot(tenantId: string): void {
  const n = inFlight.get(tenantId) ?? 0
  if (n <= 1) inFlight.delete(tenantId)
  else inFlight.set(tenantId, n - 1)
}
