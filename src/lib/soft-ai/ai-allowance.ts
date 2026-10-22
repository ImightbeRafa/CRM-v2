/**
 * Live AI allowance: may this business's inbox agents start another reply this period?
 *
 * Today the only source is the owner's monthly AI budget (SQL 051 "AiBudget", Costa Rica month, spend from SQL 048
 * "AiUsageEvent".costMicros, every feature of the business — the same truth as /super-admin/ia and the budget cron).
 * A budget is ENFORCED only when its "autoPause" is on; alert-only rows keep their meaning. A business listed in
 * AI_ALLOWANCE_EXEMPT_TENANTS (env, comma-separated tenant ids) is never capped.
 *
 * Second source (Lane H credits, SQL 060, resolveCreditAllowance): the free monthly credit + prepaid balance, or the
 * business's own monthly AI limit. It pauses only when the platform owner turned enforcement on AND saved a credit rate;
 * before SQL 060 / without that config nothing pauses. Exempt businesses and businesses OWNED by a super admin are never
 * paused by credits. A credit meter that cannot be read answers (fails open) and alerts the platform owner once an hour.
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

export type AiAllowanceSource = 'none' | 'exempt' | 'ai_budget' | 'credits'

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
  /** credits only: which cap stopped it (the free / prepaid credit, or the business's own monthly limit). */
  cap?: 'credit' | 'limit'
  /** A business-wide pause is possible (an enforcing budget or credits): the per-chat model cap applies. */
  guarded?: boolean
}

/** The credits source as decideAllowance reads it (from resolveCreditAllowance). */
export type AllowanceCredits = { enforce: boolean; exhausted: boolean; cap: 'credit' | 'limit'; periodKey: string; renewsAt: Date | null }

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
export function decideAllowance(input: {
  exempt: boolean
  budget: AllowanceBudget | null
  spentMicros: number
  now: Date
  credits?: AllowanceCredits | null
  /** Owned by a super admin (the platform owner's own business): credits never pause it. */
  ownerBusiness?: boolean
}): AiAllowance {
  const budgetAllowance = decideBudgetAllowance(input)
  if (input.exempt || budgetAllowance.exhausted) return budgetAllowance
  const c = input.credits
  if (c && c.enforce && c.exhausted && !input.ownerBusiness) {
    return {
      source: 'credits',
      enforce: true,
      limitMicros: null,
      spentMicros: budgetAllowance.spentMicros,
      remainingMicros: 0,
      periodKey: c.periodKey,
      renewsAt: c.renewsAt,
      exhausted: true,
      cap: c.cap,
    }
  }
  return budgetAllowance
}

function decideBudgetAllowance(input: { exempt: boolean; budget: AllowanceBudget | null; spentMicros: number; now: Date }): AiAllowance {
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

const OWNER_TTL_MS = 10 * 60_000
const ownerBusinessCache = new Map<string, { at: number; owner: boolean }>()
/** A business with an active OWNER who is an active super admin. A read error counts as "owner" (answer, never a silent stop). */
async function isOwnerBusiness(tenantId: string, nowMs: number): Promise<boolean> {
  const hit = ownerBusinessCache.get(tenantId)
  if (hit && nowMs - hit.at < OWNER_TTL_MS) return hit.owner
  try {
    const row = await prisma.membership.findFirst({
      // SecureDog #127-1: only the OWNER row created when the business was registered (not invited, not promoted — an
      // owner can promote any member to OWNER), so a business can never make itself "owned by a super admin".
      where: { tenantId, role: 'OWNER', isActive: true, invitedBy: null, invitedAt: null, user: { isSuperAdmin: true, active: true } },
      select: { userId: true },
    })
    remember(ownerBusinessCache, tenantId, { at: nowMs, owner: row !== null })
    return row !== null
  } catch (error) {
    console.error('[soft-ai/ai-allowance] owner read failed', error instanceof Error ? error.name : 'unknown')
    void alertCreditMeterDown(nowMs)
    return true
  }
}

let lastMeterAlertAt = 0
/** The credit meter could not be read: the agents keep answering; the platform owner hears it once an hour. */
async function alertCreditMeterDown(nowMs: number): Promise<void> {
  if (nowMs - lastMeterAlertAt < 60 * 60_000) return
  try {
    const { sendOpsAlert } = await import('@/lib/ops/alert-email')
    // SecureDog #127-5: the hourly slot is used only by an alert that really went out.
    const result = await sendOpsAlert({
      key: `ai-credits:meter-down:${new Date(nowMs).toISOString().slice(0, 13)}`,
      subject: 'No se pudo leer el crédito de IA',
      lines: [
        'Betsy no pudo leer el crédito de IA de un negocio. Las IA siguen respondiendo (no se pausa nada por esto).',
        'Revisá Logística › Admin › IA y los logs de "ai-billing/allowance".',
      ],
    })
    if (result === 'sent') lastMeterAlertAt = nowMs
  } catch (error) {
    console.error('[soft-ai/ai-allowance] meter alert failed', error instanceof Error ? error.name : 'unknown')
  }
}

/**
 * The business's live allowance now: the owner's monthly budget, then the credits (exempt always wins). Never throws: a
 * read error fails open with the last known value.
 */
/** The readers resolveAiAllowance uses (injectable for tests; the defaults read the DB). */
export type AllowanceReaders = {
  budget: (tenantId: string, now: Date) => Promise<AiAllowance>
  credits: (tenantId: string, now: Date) => Promise<(AllowanceCredits & { failedOpen?: boolean }) | null>
  ownerBusiness: (tenantId: string, nowMs: number) => Promise<boolean>
  alert: (nowMs: number) => Promise<void>
}
const DB_READERS: AllowanceReaders = {
  budget: (tenantId, now) => resolveBudgetAllowance(tenantId, now),
  credits: (tenantId, now) => resolveCreditsSafe(tenantId, now),
  ownerBusiness: (tenantId, nowMs) => isOwnerBusiness(tenantId, nowMs),
  alert: (nowMs) => alertCreditMeterDown(nowMs),
}

export async function resolveAiAllowance(tenantId: string, now = new Date(), readers: AllowanceReaders = DB_READERS): Promise<AiAllowance> {
  if (exemptTenantIds().has(tenantId)) return decideAllowance({ exempt: true, budget: null, spentMicros: 0, now })
  const [budgetAllowance, credits] = await Promise.all([readers.budget(tenantId, now), readers.credits(tenantId, now)])
  if (budgetAllowance.exhausted) return { ...budgetAllowance, guarded: true }
  if (!credits) return { ...budgetAllowance, guarded: budgetAllowance.enforce }
  if (credits.failedOpen) void readers.alert(now.getTime())
  if (!(credits.enforce && credits.exhausted)) return { ...budgetAllowance, guarded: budgetAllowance.enforce || credits.enforce }
  const decided = decideAllowance({
    exempt: false,
    budget: null,
    spentMicros: budgetAllowance.spentMicros,
    now,
    credits,
    ownerBusiness: await readers.ownerBusiness(tenantId, now.getTime()),
  })
  return { ...decided, guarded: true }
}

async function resolveCreditsSafe(tenantId: string, now: Date): Promise<(AllowanceCredits & { failedOpen?: boolean }) | null> {
  try {
    const { resolveCreditAllowance } = await import('@/lib/ai-billing/allowance')
    return await resolveCreditAllowance(tenantId, now)
  } catch (error) {
    console.error('[soft-ai/ai-allowance] credits read failed', error instanceof Error ? error.name : 'unknown')
    void alertCreditMeterDown(now.getTime())
    return null
  }
}

/** The owner's monthly AI budget (SQL 051). */
async function resolveBudgetAllowance(tenantId: string, now: Date): Promise<AiAllowance> {
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
