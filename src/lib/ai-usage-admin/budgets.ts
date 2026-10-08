/**
 * AI budgets (SQL 051 "AiBudget"): a monthly spend limit per business and one global limit. Owner only.
 * checkAiBudgets() (cron, every 5 min) alerts the owner by email at 80% and 100% (once per threshold per month)
 * and, for a business with autoPause, arms that business's agent kill switch at 100% so its inbox agents stop
 * (chats keep working for people; the alert says so). Never throws to the cron.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { killTenantKey, writeAgentKill } from '@/lib/soft-ai/agent-kill-switch'
import { sendOpsAlert } from '@/lib/ops/alert-email'
import { loadMonthSpendByScope } from '@/lib/ai-usage-admin/summary'

const TABLE = 'AiBudget'
export const MAX_BUDGET_MICROS = 100_000 * 1_000_000 // US$100k sanity cap

export type AiBudget = {
  scope: string
  monthlyUsdMicros: number
  autoPause: boolean
  alertedMonth: string | null
  alertedPct: number
}

export class AiBudgetNotReadyError extends Error {
  constructor() {
    super('AI_BUDGET_NOT_READY')
    this.name = 'AiBudgetNotReadyError'
  }
}

export async function listAiBudgets(): Promise<{ available: boolean; budgets: AiBudget[] }> {
  if (!(await isTableReady(TABLE))) return { available: false, budgets: [] }
  try {
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "scope", "monthlyUsdMicros", "autoPause", "alertedMonth", "alertedPct" FROM "AiBudget" ORDER BY "scope"`
    return {
      available: true,
      budgets: rows.map((r) => ({
        scope: String(r.scope),
        monthlyUsdMicros: Number(r.monthlyUsdMicros),
        autoPause: r.autoPause === true,
        alertedMonth: r.alertedMonth ? String(r.alertedMonth) : null,
        alertedPct: Number(r.alertedPct || 0),
      })),
    }
  } catch (error) {
    if (isMissingRelation(error)) return { available: false, budgets: [] }
    throw error
  }
}

/** Upsert (scope = 'global' or an existing tenant id; caller is a super admin). monthlyUsd null = delete. */
export async function saveAiBudget(input: {
  scope: string
  monthlyUsd: number | null
  autoPause: boolean
  updatedBy: string
}): Promise<void> {
  if (!(await isTableReady(TABLE))) throw new AiBudgetNotReadyError()
  if (input.monthlyUsd == null) {
    await prisma.$executeRaw`DELETE FROM "AiBudget" WHERE "scope" = ${input.scope}`
    return
  }
  const micros = Math.min(Math.max(1, Math.round(input.monthlyUsd * 1_000_000)), MAX_BUDGET_MICROS)
  await prisma.$executeRaw`
    INSERT INTO "AiBudget" ("scope", "monthlyUsdMicros", "autoPause", "updatedBy", "updatedAt")
    VALUES (${input.scope}, ${micros}, ${input.autoPause}, ${input.updatedBy}, NOW())
    ON CONFLICT ("scope") DO UPDATE SET
      "monthlyUsdMicros" = EXCLUDED."monthlyUsdMicros", "autoPause" = EXCLUDED."autoPause",
      "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW()`
}

function monthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Pure: which threshold (0 / 80 / 100) to alert now, given spend and what was already alerted this month. */
export function budgetAlertLevel(input: {
  spentMicros: number
  budgetMicros: number
  alertedMonth: string | null
  alertedPct: number
  month: string
}): 0 | 80 | 100 {
  if (input.budgetMicros <= 0) return 0
  const pct = (input.spentMicros / input.budgetMicros) * 100
  const already = input.alertedMonth === input.month ? input.alertedPct : 0
  if (pct >= 100 && already < 100) return 100
  if (pct >= 80 && already < 80) return 80
  return 0
}

export async function checkAiBudgets(now = new Date()): Promise<{ checked: number; alerts: number; paused: number }> {
  const summary = { checked: 0, alerts: 0, paused: 0 }
  try {
    const { available, budgets } = await listAiBudgets()
    if (!available || budgets.length === 0) return summary
    const spend = await loadMonthSpendByScope(now)
    const month = monthKey(now)
    const tenantNames = new Map(
      (
        await prisma.tenant.findMany({
          where: { id: { in: budgets.map((b) => b.scope).filter((s) => s !== 'global') } },
          select: { id: true, name: true },
        })
      ).map((t) => [t.id, t.name]),
    )
    for (const b of budgets) {
      summary.checked += 1
      const spent = spend.get(b.scope) ?? 0
      const level = budgetAlertLevel({
        spentMicros: spent,
        budgetMicros: b.monthlyUsdMicros,
        alertedMonth: b.alertedMonth,
        alertedPct: b.alertedPct,
        month,
      })
      if (!level) continue
      const name = b.scope === 'global' ? 'toda la plataforma' : tenantNames.get(b.scope) || 'un negocio'
      let paused = false
      if (level === 100 && b.autoPause && b.scope !== 'global') {
        await writeAgentKill({
          key: killTenantKey(b.scope),
          armed: true,
          updatedBy: 'ai-budget',
          reason: `Presupuesto de IA del mes alcanzado (${month})`,
        }).catch(() => {})
        paused = true
        summary.paused += 1
      }
      await sendOpsAlert({
        key: `ai-budget:${b.scope}:${month}:${level}`,
        subject: `IA: ${level}% del presupuesto de ${name}`,
        lines: [
          `Gasto estimado del mes: US$${(spent / 1e6).toFixed(2)} de US$${(b.monthlyUsdMicros / 1e6).toFixed(2)}.`,
          paused
            ? 'Los agentes de IA de este negocio quedaron en pausa (las personas siguen atendiendo los chats). Reactivalos en Agent Ops.'
            : 'Revisá el detalle en /super-admin/ia.',
        ],
      })
      await prisma.$executeRaw`
        UPDATE "AiBudget" SET "alertedMonth" = ${month}, "alertedPct" = ${level} WHERE "scope" = ${b.scope}`
      summary.alerts += 1
    }
  } catch (error) {
    console.error('[ai-budget] check failed', error instanceof Error ? error.name : 'unknown')
  }
  return summary
}
