/**
 * AI budgets (SQL 051 "AiBudget"): a monthly spend limit per business and one global limit. Owner only.
 * Months are Costa Rica calendar months. checkAiBudgets() (cron, every 5 min):
 *  - alerts the owner at 80% and 100% (email + bell), once per threshold per month; an alert only counts as done
 *    when it was delivered (a mail outage retries on the next tick);
 *  - for a business with autoPause, arms that business's agent kill switch at 100% and tells the business's team
 *    (bell) that the AI is paused and people must answer. The pause has its own marker: a failed pause is retried,
 *    and a pause the owner lifted is never re-armed in the same month.
 * Changing a budget (amount or auto-pause) resets that month's markers so the new limit is enforced.
 * Never throws to the cron.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { killTenantKey, writeAgentKill } from '@/lib/soft-ai/agent-kill-switch'
import { sendOpsAlert } from '@/lib/ops/alert-email'
import { filterChatMembers, notifyUsers } from '@/lib/workspace-notifications'
import { costaRicaMonthKey, loadMonthSpendByScope } from '@/lib/ai-usage-admin/summary'

const TABLE = 'AiBudget'
export const MAX_BUDGET_MICROS = 100_000 * 1_000_000 // US$100k sanity cap

export type AiBudget = {
  scope: string
  monthlyUsdMicros: number
  autoPause: boolean
  alertedMonth: string | null
  alertedPct: number
  pausedMonth: string | null
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
      SELECT "scope", "monthlyUsdMicros", "autoPause", "alertedMonth", "alertedPct", "pausedMonth"
        FROM "AiBudget" ORDER BY "scope"`
    return {
      available: true,
      budgets: rows.map((r) => ({
        scope: String(r.scope),
        monthlyUsdMicros: Number(r.monthlyUsdMicros),
        autoPause: r.autoPause === true,
        alertedMonth: r.alertedMonth ? String(r.alertedMonth) : null,
        alertedPct: Number(r.alertedPct || 0),
        pausedMonth: r.pausedMonth ? String(r.pausedMonth) : null,
      })),
    }
  } catch (error) {
    if (isMissingRelation(error)) return { available: false, budgets: [] }
    throw error
  }
}

export async function deleteAiBudget(scope: string): Promise<void> {
  if (!(await isTableReady(TABLE))) throw new AiBudgetNotReadyError()
  await prisma.$executeRaw`DELETE FROM "AiBudget" WHERE "scope" = ${scope}`
}

/** Upsert (scope = 'global' or an existing tenant id; caller is a super admin). */
export async function saveAiBudget(input: { scope: string; monthlyUsd: number; autoPause: boolean; updatedBy: string }): Promise<void> {
  if (!(await isTableReady(TABLE))) throw new AiBudgetNotReadyError()
  const micros = Math.min(Math.max(1, Math.round(input.monthlyUsd * 1_000_000)), MAX_BUDGET_MICROS)
  // A changed amount or auto-pause resets this month's alert/pause markers, so the NEW limit is enforced.
  await prisma.$executeRaw`
    INSERT INTO "AiBudget" ("scope", "monthlyUsdMicros", "autoPause", "updatedBy", "updatedAt")
    VALUES (${input.scope}, ${micros}, ${input.autoPause}, ${input.updatedBy}, NOW())
    ON CONFLICT ("scope") DO UPDATE SET
      "alertedMonth" = CASE WHEN "AiBudget"."monthlyUsdMicros" <> EXCLUDED."monthlyUsdMicros"
                              OR "AiBudget"."autoPause" <> EXCLUDED."autoPause" THEN NULL ELSE "AiBudget"."alertedMonth" END,
      "alertedPct" = CASE WHEN "AiBudget"."monthlyUsdMicros" <> EXCLUDED."monthlyUsdMicros"
                            OR "AiBudget"."autoPause" <> EXCLUDED."autoPause" THEN 0 ELSE "AiBudget"."alertedPct" END,
      "pausedMonth" = CASE WHEN "AiBudget"."monthlyUsdMicros" <> EXCLUDED."monthlyUsdMicros"
                             OR "AiBudget"."autoPause" <> EXCLUDED."autoPause" THEN NULL ELSE "AiBudget"."pausedMonth" END,
      "monthlyUsdMicros" = EXCLUDED."monthlyUsdMicros",
      "autoPause" = EXCLUDED."autoPause",
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()`
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

/** Pure: should the business's agents be paused now? (100% + auto-pause + not yet paused this month.) */
export function shouldPause(input: { scope: string; autoPause: boolean; spentMicros: number; budgetMicros: number; pausedMonth: string | null; month: string }): boolean {
  return (
    input.scope !== 'global' &&
    input.autoPause &&
    input.budgetMicros > 0 &&
    input.spentMicros >= input.budgetMicros &&
    input.pausedMonth !== input.month
  )
}

/** Bell for the platform owners (each in a business they belong to). Best effort. */
async function notifyOwners(dedupeKey: string): Promise<void> {
  const owners = await prisma.user.findMany({ where: { isSuperAdmin: true, active: true }, select: { id: true }, take: 10 })
  for (const o of owners) {
    const m = await prisma.membership.findFirst({ where: { userId: o.id, isActive: true }, select: { tenantId: true }, orderBy: { joinedAt: "asc" } })
    if (!m) continue
    await notifyUsers({ tenantId: m.tenantId, actorUserId: null, kind: 'ai_budget', userIds: [o.id], dedupeKey: () => dedupeKey }).catch(() => 0)
  }
}

/** Bell for the paused business's team: the AI stopped, people must answer. */
async function notifyBusinessTeam(tenantId: string, month: string, stamp: number): Promise<void> {
  const members = await prisma.membership.findMany({ where: { tenantId, isActive: true, user: { active: true } }, select: { userId: true }, take: 50 })
  const userIds = (await filterChatMembers(tenantId, members.map((m) => m.userId))).slice(0, 20)
  if (!userIds.length) return
  await notifyUsers({ tenantId, actorUserId: null, kind: 'ai_budget', userIds, dedupeKey: () => `ai_budget:paused:${tenantId}:${month}:${stamp}` }).catch(() => 0)
}

export async function checkAiBudgets(now = new Date()): Promise<{ checked: number; alerts: number; paused: number }> {
  const summary = { checked: 0, alerts: 0, paused: 0 }
  try {
    const { available, budgets } = await listAiBudgets()
    if (!available || budgets.length === 0) return summary
    const spend = await loadMonthSpendByScope(now)
    const month = costaRicaMonthKey(now)
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
      try {
        const spent = spend.get(b.scope) ?? 0
        const name = b.scope === 'global' ? 'toda la plataforma' : tenantNames.get(b.scope) || 'un negocio'

        // 1) Pause (own marker; only marked when the switch really was armed).
        let pausedNow = false
        if (shouldPause({ scope: b.scope, autoPause: b.autoPause, spentMicros: spent, budgetMicros: b.monthlyUsdMicros, pausedMonth: b.pausedMonth, month })) {
          try {
            await writeAgentKill({
              key: killTenantKey(b.scope),
              armed: true,
              updatedBy: 'ai-budget',
              reason: `Presupuesto de IA del mes alcanzado (${month})`,
            })
            await prisma.$executeRaw`UPDATE "AiBudget" SET "pausedMonth" = ${month} WHERE "scope" = ${b.scope}`
            pausedNow = true
            summary.paused += 1
          } catch (error) {
            console.error('[ai-budget] pause failed', error instanceof Error ? error.name : 'unknown')
          }
        }

        // The team bell has its own try: a failed bell never makes the owner think the pause failed.
        if (pausedNow) await notifyBusinessTeam(b.scope, month, b.monthlyUsdMicros).catch(() => undefined)

        // 2) Owner alert (only marked when delivered or email is not configured; a failed send retries).
        const level = budgetAlertLevel({ spentMicros: spent, budgetMicros: b.monthlyUsdMicros, alertedMonth: b.alertedMonth, alertedPct: b.alertedPct, month })
        if (!level) {
          // Pause applied on a later tick than the 100% alert: tell the owner it worked.
          if (pausedNow) {
            await sendOpsAlert({
              key: `ai-budget:${b.scope}:${month}:paused:${b.monthlyUsdMicros}`,
              subject: `IA: agentes de ${name} en pausa`,
              lines: ['Pausa aplicada: los agentes de IA de este negocio quedaron en pausa por presupuesto. Reactivalos en Agent Ops.'],
            }).catch(() => undefined)
          }
          continue
        }
        const result = await sendOpsAlert({
          key: `ai-budget:${b.scope}:${month}:${level}:${b.monthlyUsdMicros}`,
          subject: `IA: ${level}% del presupuesto de ${name}`,
          lines: [
            `Gasto estimado del mes: US$${(spent / 1e6).toFixed(2)} de US$${(b.monthlyUsdMicros / 1e6).toFixed(2)}.`,
            pausedNow || b.pausedMonth === month
              ? 'Los agentes de IA de este negocio quedaron en pausa (las personas siguen atendiendo los chats y el equipo fue avisado). Reactivalos en Agent Ops.'
              : level === 100 && b.autoPause && b.scope !== 'global'
                ? 'No se pudo pausar los agentes; se reintenta en 5 minutos.'
                : 'Revisá el detalle en /super-admin/ia.',
          ],
        })
        await notifyOwners(`ai_budget:${b.scope}:${month}:${level}:${b.monthlyUsdMicros}`)
        if (result === 'failed') continue
        await prisma.$executeRaw`
          UPDATE "AiBudget" SET "alertedMonth" = ${month}, "alertedPct" = ${level} WHERE "scope" = ${b.scope}`
        summary.alerts += 1
      } catch (error) {
        console.error('[ai-budget] scope check failed', error instanceof Error ? error.name : 'unknown')
      }
    }
  } catch (error) {
    console.error('[ai-budget] check failed', error instanceof Error ? error.name : 'unknown')
  }
  return summary
}
