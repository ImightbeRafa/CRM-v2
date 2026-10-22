/**
 * Lane D (2026-10-22): live AI spend cap. When a business's AI allowance for the month is used up, the agent stops
 * before the model and the chat goes to a person with a note (never a silent drop, never a half reply).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/ai-allowance.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideAllowance, exemptTenantIds } from '@/lib/soft-ai/ai-allowance'
import { costaRicaMonthStartUtc, costaRicaPeriodKey, nextCostaRicaMonthStartUtc } from '@/lib/ai-usage/period'
import { costaRicaMonthKey } from '@/lib/ai-usage-admin/summary'
import { HANDOFF_REASON_LABELS } from '@/lib/workspace-notifications'
import { normalizeHandoffReason } from '@/lib/soft-ai/handoff-notify'
import { turnAllowsRearm } from '@/lib/soft-ai/waiting-sweep'

const read = (p: string) => readFileSync(p, 'utf8')
const NOW = new Date('2026-10-22T18:00:00Z')
const USD = (n: number) => n * 1_000_000

describe('AI allowance: rules (decideAllowance)', () => {
  it('no budget, or an alert-only budget, caps nothing', () => {
    assert.equal(decideAllowance({ exempt: false, budget: null, spentMicros: USD(999), now: NOW }).exhausted, false)
    const alertOnly = decideAllowance({ exempt: false, budget: { monthlyUsdMicros: USD(10), autoPause: false }, spentMicros: USD(50), now: NOW })
    assert.equal(alertOnly.enforce, false)
    assert.equal(alertOnly.exhausted, false)
    assert.equal(alertOnly.source, 'none')
  })

  it('an enforcing budget stops at 100% and renews at the next Costa Rica month', () => {
    const budget = { monthlyUsdMicros: USD(10), autoPause: true }
    const under = decideAllowance({ exempt: false, budget, spentMicros: USD(9.99), now: NOW })
    assert.equal(under.enforce, true)
    assert.equal(under.exhausted, false)
    assert.equal(under.remainingMicros, 10_000)
    const at = decideAllowance({ exempt: false, budget, spentMicros: USD(10), now: NOW })
    assert.equal(at.exhausted, true)
    assert.equal(at.remainingMicros, 0)
    assert.equal(at.source, 'ai_budget')
    assert.equal(at.periodKey, '2026-10')
    assert.equal(at.renewsAt?.toISOString(), '2026-11-01T06:00:00.000Z')
    assert.equal(decideAllowance({ exempt: false, budget, spentMicros: USD(25), now: NOW }).exhausted, true)
  })

  it('an exempt business is never capped, whatever its budget', () => {
    const a = decideAllowance({ exempt: true, budget: { monthlyUsdMicros: USD(1), autoPause: true }, spentMicros: USD(100), now: NOW })
    assert.equal(a.source, 'exempt')
    assert.equal(a.exhausted, false)
    assert.deepEqual([...exemptTenantIds(' t1, ,t2 ,')], ['t1', 't2'])
    assert.equal(exemptTenantIds('').size, 0)
    assert.equal(exemptTenantIds(undefined).size, exemptTenantIds(process.env.AI_ALLOWANCE_EXEMPT_TENANTS).size)
  })

  it('a zero / negative / NaN budget never caps', () => {
    for (const m of [0, -5, Number.NaN]) {
      assert.equal(decideAllowance({ exempt: false, budget: { monthlyUsdMicros: m, autoPause: true }, spentMicros: USD(1), now: NOW }).exhausted, false)
    }
  })
})

describe('AI allowance: Costa Rica months (UTC-6, no DST)', () => {
  it('Oct 1 00:30 in Costa Rica is October; Sep 30 23:59 is September', () => {
    assert.equal(costaRicaPeriodKey(new Date('2026-10-01T06:30:00Z')), '2026-10')
    assert.equal(costaRicaPeriodKey(new Date('2026-10-01T05:59:00Z')), '2026-09')
    assert.equal(costaRicaMonthStartUtc(new Date('2026-10-01T05:59:00Z')).toISOString(), '2026-09-01T06:00:00.000Z')
    assert.equal(costaRicaMonthStartUtc(NOW).toISOString(), '2026-10-01T06:00:00.000Z')
    assert.equal(nextCostaRicaMonthStartUtc(new Date('2026-12-31T23:00:00Z')).toISOString(), '2027-01-01T06:00:00.000Z')
  })
  it('agrees with the budget cron month key', () => {
    for (const iso of ['2026-11-01T02:00:00Z', '2026-11-01T07:00:00Z', '2026-01-01T05:00:00Z', '2026-03-15T12:00:00Z']) {
      assert.equal(costaRicaPeriodKey(new Date(iso)), costaRicaMonthKey(new Date(iso)), iso)
    }
  })
})

describe('AI allowance: wiring', () => {
  const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
  const pre = gates.slice(gates.indexOf('export async function runPreModelGates'), gates.indexOf('export async function runPreSendGates'))
  const send = gates.slice(gates.indexOf('export async function runPreSendGates'))
  const turn = read('src/lib/soft-ai/agent-turn.ts')
  const allowance = read('src/lib/soft-ai/ai-allowance.ts')

  it('checked once before the model, after the AI terms; never at pre-send (a started turn finishes)', () => {
    assert.match(pre, /\(await resolveAiAllowance\(input\.tenantId\)\)\.exhausted/)
    assert.match(pre, /status: 'budget_blocked', skipReason: 'ai_allowance_exhausted'/)
    assert.ok(pre.indexOf('aiTermsAccepted(config)') < pre.indexOf('resolveAiAllowance'))
    assert.doesNotMatch(send, /resolveAiAllowance/)
    assert.doesNotMatch(pre, /loadDailyBilledTokens|dailyTokenCap\s*[<>]/)
  })

  it('an exhausted allowance hands the chat to a person (aiMode human + assigned bell), not a silent skip', () => {
    const branch = turn.slice(turn.indexOf("if (preModel.skipReason === 'ai_allowance_exhausted')"), turn.indexOf("} else if (preModel.status === 'budget_blocked')"))
    assert.match(branch, /await settleHandoff\(row, \{ kind: 'handoff', reason: HANDOFF_REASON\.aiAllowance \}, hours\)/)
    // persisted as a skipped turn first (status budget_blocked, reason ai_allowance_exhausted)
    const before = turn.slice(0, turn.indexOf("if (preModel.skipReason === 'ai_allowance_exhausted')"))
    assert.match(before.slice(-700), /skipReason: preModel\.skipReason \|\| 'flag_off',\s+status: preModel\.status,/)
    assert.equal(normalizeHandoffReason('ai_allowance', 'handoff'), 'ai_allowance')
    assert.match(HANDOFF_REASON_LABELS.ai_allowance, /saldo de IA/)
  })

  it('the periodic sweep does not re-queue it; the line-on check sees the allowance', () => {
    assert.equal(turnAllowsRearm({ status: 'budget_blocked', skipReason: 'ai_allowance_exhausted' }, 'periodic'), false)
    assert.match(read('src/lib/soft-ai/waiting-sweep.ts'), /if \(\(await resolveAiAllowance\(tenantId\)\)\.exhausted\) return false/)
    assert.match(read('src/lib/soft-ai/agent-status-server.ts'), /budget: \{ tenantExhausted: allowanceExhausted, agentExhausted: false \}/)
  })

  it('missing tables cap nothing; a broken meter fails open; the owner budget change clears the cache', () => {
    assert.match(allowance, /if \(!\(await isTableReady\('AiBudget'\)\)\) return null/)
    assert.match(allowance, /if \(!\(await isTableReady\('AiUsageEvent'\)\)\) return 0/)
    assert.match(allowance, /spend read failed[\s\S]{0,200}last\.period === costaRicaPeriodKey\(now\) \? last\.spent : 0/)
    // index-friendly range (no AT TIME ZONE on the column)
    assert.match(allowance, /WHERE "tenantId" = \$\{tenantId\} AND "createdAt" >= \$\{costaRicaMonthStartUtc\(now\)\}/)
    const budgets = read('src/lib/ai-usage-admin/budgets.ts')
    assert.equal(budgets.match(/clearAllowanceCache\((?:scope|input\.scope)\)/g)?.length, 2)
  })

  it('the never-enforced per-agent daily token field is gone from Config and ignored by the API', () => {
    assert.doesNotMatch(read('src/app/config/agentes/AgentBusinessCard.tsx'), /dailyTokenCap|Límite diario de este agente/)
    assert.doesNotMatch(read('src/app/api/chat/agents/[id]/settings/route.ts'), /patch\.dailyTokenCap\s*=/)
  })
})
