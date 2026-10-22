/**
 * Credits / business-limit source for the live AI allowance (Lane D owns src/lib/soft-ai/ai-allowance.ts and
 * plugs this in as AiAllowanceSource 'credits'; spec: docs/plans/ai-credits-allowance-spec.md).
 *
 * Same contract as the AiBudget source: soft cap checked before a turn starts, cached a few seconds, and it FAILS
 * OPEN (last known value, else allowed) — a broken meter must never silence every chat. Before SQL 060, with
 * enforcement off, or for an exempt business: enforce=false, never exhausted.
 * Amounts are returned in LIST micros (what AiUsageEvent.costMicros counts) so they compare with the budget source.
 */
import 'server-only'

import { costaRicaPeriodKey } from '@/lib/ai-usage/period'
import { aiExemptTenantIds, listFromBilled } from './math'
import { getCreditState } from './state'
import { getSettings, listRates } from './store'

export type CreditAllowance = {
  source: 'credits'
  enforce: boolean
  exhausted: boolean
  /** Which cap stops it: the prepaid/free credit or the business's own monthly limit. */
  cap: 'credit' | 'limit'
  periodKey: string
  renewsAt: Date | null
  /** List micros the business may still spend this month (null when nothing is enforced). */
  remainingListMicros: number | null
  /** Lane D: the meter could not be read and the answer failed open (the caller alerts the platform owner). */
  failedOpen?: boolean
}

const TTL_MS = 30_000
const NEAR_TTL_MS = 5_000
const MAX_CACHE = 2_000
const cache = new Map<string, { at: number; value: CreditAllowance }>()

export function clearCreditAllowanceCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

function open(now: Date): CreditAllowance {
  return { source: 'credits', enforce: false, exhausted: false, cap: 'credit', periodKey: costaRicaPeriodKey(now), renewsAt: null, remainingListMicros: null }
}

export async function resolveCreditAllowance(tenantId: string, now = new Date()): Promise<CreditAllowance> {
  const hit = cache.get(tenantId)
  if (hit && hit.value.periodKey === costaRicaPeriodKey(now)) {
    const near = hit.value.enforce && (hit.value.remainingListMicros ?? Infinity) < 50_000
    if (now.getTime() - hit.at < (near ? NEAR_TTL_MS : TTL_MS)) return hit.value
  }
  try {
    // Cheap exits first (settings are cached 60 s): no per-tenant reads while nothing can pause.
    if (aiExemptTenantIds().has(tenantId) || !(await getSettings()).enforce) return open(now)
    const s = await getCreditState(tenantId, now)
    const d = s.decision
    // Lane D (Rafael 2026-10-22): nothing pauses until the owner saved a credit rate (no config = answer).
    const configured = (await listRates()).length > 0
    const value: CreditAllowance = d.enforced && configured
      ? {
          source: 'credits',
          enforce: true,
          exhausted: d.exhausted,
          cap: d.cap,
          periodKey: s.periodKey,
          renewsAt: new Date(s.renewsAt),
          remainingListMicros: listFromBilled(Math.max(0, d.remainingMicros), s.rate.markupBps),
        }
      : open(now)
    if (cache.size >= MAX_CACHE && !cache.has(tenantId)) cache.delete(cache.keys().next().value as string)
    cache.set(tenantId, { at: now.getTime(), value })
    return value
  } catch (error) {
    console.error('[ai-billing/allowance] read failed', error instanceof Error ? error.name : 'unknown')
    return hit && hit.value.periodKey === costaRicaPeriodKey(now) ? hit.value : { ...open(now), failedOpen: true }
  }
}
