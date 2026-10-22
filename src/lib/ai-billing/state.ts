/**
 * One business's AI credit state for this Costa Rica month: rate, billed usage, free credit, balance, limit and
 * the pause decision. Used by the usage page, the limit/checkout routes and resolveCreditAllowance (Lane D hook).
 */
import 'server-only'

import { costaRicaPeriodKey, nextCostaRicaMonthStartUtc } from '@/lib/ai-usage/period'
import { exemptTenantIds } from '@/lib/soft-ai/ai-allowance'
import { readCustomAgentsFlag } from '@/lib/support/agent-flag'
import { billedFromList, decideCredits, rateForPeriod, type AiBillingRate, type CreditDecision } from './math'
import {
  aiBillingReady,
  getSettings,
  getTenantLimit,
  ledgerBalance,
  listRates,
  monthListMicros,
  settleClosedMonths,
  type AiBillingSettings,
} from './store'

export type CreditState = {
  ready: boolean
  periodKey: string
  renewsAt: string
  rate: AiBillingRate
  /** Rate already saved for next month, when it differs from this month's. */
  nextRate: AiBillingRate | null
  listMicros: number
  /** Business's own limit as saved (before the owner's ceiling). */
  ownLimitMicros: number | null
  ceilingMicros: number | null
  balanceMicros: number
  agentEnabled: boolean
  exempt: boolean
  settings: Pick<AiBillingSettings, 'enforce' | 'cutoverPeriod'>
  decision: CreditDecision
}

export async function getCreditState(tenantId: string, now = new Date()): Promise<CreditState> {
  const periodKey = costaRicaPeriodKey(now)
  const ready = await aiBillingReady()
  if (ready) await settleClosedMonths(tenantId, now)
  const [settings, rates, listMicros, ownLimit, balance, flag] = await Promise.all([
    getSettings(),
    listRates(),
    monthListMicros(tenantId, periodKey),
    getTenantLimit(tenantId),
    ledgerBalance(tenantId),
    readCustomAgentsFlag(tenantId).catch(() => null),
  ])
  const rate = rateForPeriod(rates, periodKey)
  const next = rates.find((r) => r.periodKey > periodKey) ?? null
  const exempt = exemptTenantIds().has(tenantId)
  const decision = decideCredits({
    billedMicros: billedFromList(listMicros, rate.markupBps),
    freeMicros: rate.freeMonthlyMicros,
    balanceMicros: balance,
    limitMicros: ownLimit,
    ceilingMicros: settings.ceilingMicros,
    // Nothing pauses before SQL 060 is applied or while the owner keeps enforcement off.
    enforce: ready && settings.enforce,
    exempt,
  })
  return {
    ready,
    periodKey,
    renewsAt: nextCostaRicaMonthStartUtc(now).toISOString(),
    rate,
    nextRate: next,
    listMicros,
    ownLimitMicros: ownLimit,
    ceilingMicros: settings.ceilingMicros,
    balanceMicros: balance,
    agentEnabled: flag?.enabled === true,
    exempt,
    settings: { enforce: settings.enforce, cutoverPeriod: settings.cutoverPeriod },
    decision,
  }
}
