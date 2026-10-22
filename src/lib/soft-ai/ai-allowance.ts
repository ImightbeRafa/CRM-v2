/**
 * Live AI allowance: may this business's inbox agents start another reply this period?
 *
 * Today the only source is the owner's monthly AI budget (SQL 051 "AiBudget", Costa Rica month, spend from SQL 048
 * "AiUsageEvent".costMicros, every feature of the business — the same truth as /super-admin/ia and the budget cron).
 * A budget is ENFORCED only when its "autoPause" is on; alert-only rows keep their meaning. A business listed in
 * AI_ALLOWANCE_EXEMPT_TENANTS (env, comma-separated tenant ids) is never capped.
 *
 * Later waves plug prepaid / free credits in as another source in decideAllowance (exempt always wins).
 *
 * Soft cap: checked once before the model runs (a started turn always finishes, never a half reply), cached per
 * process for a few seconds, so a business can pass its limit by a few cents. A meter that cannot be read fails OPEN
 * (last known value, else allowed): a broken meter must never silence every chat. The budget cron arms the kill
 * switch only well past the limit, as a backstop.
 * Missing tables (SQL not applied) = nothing enforced.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { costaRicaMonthStartUtc, costaRicaPeriodKey, nextCostaRicaMonthStartUtc } from '@/lib/ai-usage/period'

export type AiAllowanceSource = 'none' | 'exempt' | 'ai_budget'

export type AiAllowance = {
  source: AiAllowanceSource
  /** True when this source caps live replies. */
  enforce: boolean
  limitMicros: number | null
  spentMicros: number
  remainingMicros: number | null
  periodKey: string
  /** When the allowance renews on its own (start of the next Costa Rica month), or null when nothing is enforced. */
  renewsAt: Date | null
  /** Live replies must stop: the chat goes to a person. */
  exhausted: boolean
}

export type AllowanceBudget = { monthlyUsdMicros: number; autoPause: boolean }

/** Tenant ids that are never capped (owner / platform businesses). Read from env on every call (no DB). */
export function exemptTenantIds(raw: string | undefined = process.env.AI_ALLOWANCE_EXEMPT_TENANTS): Set<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

/** Pure: every allowance rule lives here. */
export function decideAllowance(input: { exempt: boolean; budget: AllowanceBudget | null; spentMicros: number; now: Date }): AiAllowance {
  const periodKey = costaRicaPeriodKey(input.now)
  const spentMicros = Math.max(0, Math.floor(input.spentMicros || 0))
  const open = (source: AiAllowanceSource, limitMicros: number | null = null): AiAllowance => ({
    source,
    enforce: false,
    limitMicros,
    spentMicros,
    remainingMicros: null,
    periodKey,
    renewsAt: null,
    exhausted: false,
  })
  if (input.exempt) return open('exempt')
  const b = input.budget
  if (!b || !(b.monthlyUsdMicros > 0)) return open('none')
  if (!b.autoPause) return open('none', b.monthlyUsdMicros)
  return {
    source: 'ai_budget',
    enforce: true,
    limitMicros: b.monthlyUsdMicros,
    spentMicros,
    remainingMicros: Math.max(0, b.monthlyUsdMicros - spentMicros),
    periodKey,
    renewsAt: nextCostaRicaMonthStartUtc(input.now),
    exhausted: spentMicros >= b.monthlyUsdMicros,
  }
}

const BUDGET_TTL_MS = 60_000
const SPEND_TTL_MS = 30_000
const SPEND_NEAR_TTL_MS = 5_000
const MAX_CACHE = 2_000
const budgetCache = new Map<string, { at: number; budget: AllowanceBudget | null }>()
const spendCache = new Map<string, { at: number; period: string; spent: number }>()

function remember<T>(map: Map<string, T>, key: string, value: T) {
  if (map.size >= MAX_CACHE && !map.has(key)) map.delete(map.keys().next().value as string)
  map.set(key, value)
}

/** Drop cached budget / spend (after the owner changes a budget). No argument = everything. */
export function clearAllowanceCache(tenantId?: string): void {
  if (!tenantId) {
    budgetCache.clear()
    spendCache.clear()
    return
  }
  budgetCache.delete(tenantId)
  spendCache.delete(tenantId)
}

async function loadBudget(tenantId: string, nowMs: number): Promise<AllowanceBudget | null> {
  const hit = budgetCache.get(tenantId)
  if (hit && nowMs - hit.at < BUDGET_TTL_MS) return hit.budget
  if (!(await isTableReady('AiBudget'))) return null
  const rows = await prisma.$queryRaw<Array<{ monthlyUsdMicros: bigint | number; autoPause: boolean }>>`
    SELECT "monthlyUsdMicros", "autoPause" FROM "AiBudget" WHERE "scope" = ${tenantId} LIMIT 1`
  const budget = rows[0] ? { monthlyUsdMicros: Number(rows[0].monthlyUsdMicros), autoPause: rows[0].autoPause === true } : null
  remember(budgetCache, tenantId, { at: nowMs, budget })
  return budget
}

async function loadSpend(tenantId: string, now: Date, budget: AllowanceBudget): Promise<number> {
  const period = costaRicaPeriodKey(now)
  const hit = spendCache.get(tenantId)
  const near = hit ? hit.spent >= budget.monthlyUsdMicros * 0.9 : false
  if (hit && hit.period === period && now.getTime() - hit.at < (near ? SPEND_NEAR_TTL_MS : SPEND_TTL_MS)) return hit.spent
  if (!(await isTableReady('AiUsageEvent'))) return 0
  // Sargable on AiUsageEvent_tenant_created_idx (048): plain range on createdAt (stored UTC).
  const rows = await prisma.$queryRaw<Array<{ spent: bigint | number | null }>>`
    SELECT COALESCE(SUM("costMicros"), 0)::bigint AS "spent"
      FROM "AiUsageEvent"
     WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${costaRicaMonthStartUtc(now)}`
  const spent = Number(rows[0]?.spent ?? 0)
  remember(spendCache, tenantId, { at: now.getTime(), period, spent })
  return spent
}

/** The business's live allowance now. Never throws: a read error fails open with the last known spend. */
export async function resolveAiAllowance(tenantId: string, now = new Date()): Promise<AiAllowance> {
  if (exemptTenantIds().has(tenantId)) return decideAllowance({ exempt: true, budget: null, spentMicros: 0, now })
  let budget: AllowanceBudget | null = null
  try {
    budget = await loadBudget(tenantId, now.getTime())
  } catch (error) {
    console.error('[soft-ai/ai-allowance] budget read failed', error instanceof Error ? error.name : 'unknown')
    budget = budgetCache.get(tenantId)?.budget ?? null
  }
  if (!budget || !budget.autoPause) return decideAllowance({ exempt: false, budget, spentMicros: 0, now })
  let spent = 0
  try {
    spent = await loadSpend(tenantId, now, budget)
  } catch (error) {
    console.error('[soft-ai/ai-allowance] spend read failed', error instanceof Error ? error.name : 'unknown')
    const last = spendCache.get(tenantId)
    spent = last && last.period === costaRicaPeriodKey(now) ? last.spent : 0
  }
  return decideAllowance({ exempt: false, budget, spentMicros: spent, now })
}
