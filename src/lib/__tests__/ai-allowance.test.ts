/**
 * Lane D (2026-10-22): live AI spend cap. When a business's AI allowance for the month is used up, the agent stops
 * before the model and the chat goes to a person with a note (never a silent drop, never a half reply).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/ai-allowance.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideAllowance, exemptTenantIds, resolveAiAllowance, type AiAllowance } from '@/lib/soft-ai/ai-allowance'
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
    assert.match(pre, /const allowance = await resolveAiAllowance\(input\.tenantId\)\s*if \(allowance\.exhausted\) \{/)
    assert.match(pre, /status: 'budget_blocked', skipReason: 'ai_allowance_exhausted'/)
    assert.ok(pre.indexOf('aiTermsAccepted(config)') < pre.indexOf('resolveAiAllowance'))
    assert.doesNotMatch(send, /resolveAiAllowance/)
    assert.doesNotMatch(pre, /loadDailyBilledTokens|dailyTokenCap\s*[<>]/)
  })

  it('an exhausted allowance hands the chat to a person (aiMode human + assigned bell), not a silent skip', () => {
    const branch = turn.slice(turn.indexOf("if (preModel.skipReason === 'ai_allowance_exhausted' || preModel.skipReason === 'chat_rate_limited')"), turn.indexOf("} else if (preModel.status === 'budget_blocked')"))
    assert.match(branch, /await settleHandoff\(\s*row,\s*\{ kind: 'handoff', reason: preModel\.skipReason === 'chat_rate_limited' \? HANDOFF_REASON\.chatLimit : HANDOFF_REASON\.aiAllowance \},\s*hours,\s*\)/)
    // persisted as a skipped turn first (status budget_blocked, reason ai_allowance_exhausted)
    const before = turn.slice(0, turn.indexOf("if (preModel.skipReason === 'ai_allowance_exhausted' || preModel.skipReason === 'chat_rate_limited')"))
    assert.match(before.slice(-700), /skipReason: preModel\.skipReason \|\| 'flag_off',\s+status: preModel\.status,/)
    assert.equal(normalizeHandoffReason('ai_allowance', 'handoff'), 'ai_allowance')
    assert.match(HANDOFF_REASON_LABELS.ai_allowance, /saldo de IA/)
  })

  it('Verifier r1: only an answering line hands off; an already generated (paid) reply still goes out', () => {
    const bypass = turn.slice(turn.indexOf("if (!preModel.ok && (preModel.skipReason === 'ai_allowance_exhausted' || preModel.skipReason === 'chat_rate_limited'))"), turn.indexOf('if (!preModel.ok) {'))
    assert.ok(bypass.includes("const lineAnswers = resolved.agent.operationMode === 'ai_full' && resolved.unlockedForSend"))
    assert.ok(bypass.includes("if (!lineAnswers || (generated?.status === 'generated' && generated.outputText && generated.outputHash)) preModel = { ok: true }"))
    // the not_activated skip and the generated-output reuse both come after it
    assert.ok(turn.indexOf('const lineAnswers = resolved.agent.operationMode') < turn.indexOf("skipReason: 'not_activated'"))
    assert.ok(turn.indexOf('const lineAnswers = resolved.agent.operationMode') < turn.indexOf("existing.status === 'generated' &&"))
  })

  it('Verifier r1: the exempt list and the order-data switch reach the Cloudflare container', () => {
    const worker = read('src/cf-container-worker.ts')
    for (const k of ['AI_ALLOWANCE_EXEMPT_TENANTS', 'SOFT_AI_ORDER_DATA_CHOICE']) {
      assert.match(worker, new RegExp(`"${k}",`))
      assert.match(worker, new RegExp(`${k}\\?: string;`))
    }
  })

  it('the periodic sweep does not re-queue it; the line-on check sees the allowance', () => {
    assert.equal(turnAllowsRearm({ status: 'budget_blocked', skipReason: 'ai_allowance_exhausted' }, 'periodic'), false)
    assert.match(read('src/lib/soft-ai/waiting-sweep.ts'), /if \(\(await resolveAiAllowance\(tenantId\)\)\.exhausted\) return false/)
    assert.match(read('src/lib/soft-ai/agent-status-server.ts'), /budget: \{ tenantExhausted: allowanceExhausted, agentExhausted: false, cap: allowance\.source === 'credits' \? allowance\.cap : undefined \}/)
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

describe('AI allowance: credits source (Lane H, SQL 060)', () => {
  const credits = (over: Partial<{ enforce: boolean; exhausted: boolean; cap: 'credit' | 'limit' }> = {}) => ({
    enforce: true,
    exhausted: true,
    cap: 'credit' as const,
    periodKey: '2026-10',
    renewsAt: new Date('2026-11-01T06:00:00Z'),
    ...over,
  })
  it('used-up credits pause, with the cap that stopped it', () => {
    const a = decideAllowance({ exempt: false, budget: null, spentMicros: USD(3), now: NOW, credits: credits() })
    assert.equal(a.source, 'credits')
    assert.equal(a.exhausted, true)
    assert.equal(a.cap, 'credit')
    assert.equal(a.renewsAt?.toISOString(), '2026-11-01T06:00:00.000Z')
    assert.equal(decideAllowance({ exempt: false, budget: null, spentMicros: 0, now: NOW, credits: credits({ cap: 'limit' }) }).cap, 'limit')
  })
  it('credits not enforced (before SQL 060, enforcement off, no rate saved) never pause', () => {
    for (const c of [credits({ enforce: false, exhausted: false }), credits({ enforce: false }), credits({ exhausted: false }), null]) {
      assert.equal(decideAllowance({ exempt: false, budget: null, spentMicros: USD(50), now: NOW, credits: c }).exhausted, false)
    }
  })
  it('exempt and super-admin-owned businesses are never paused by credits; an exhausted budget still wins first', () => {
    assert.equal(decideAllowance({ exempt: true, budget: null, spentMicros: 0, now: NOW, credits: credits() }).exhausted, false)
    assert.equal(decideAllowance({ exempt: false, budget: null, spentMicros: 0, now: NOW, credits: credits(), ownerBusiness: true }).exhausted, false)
    const b = decideAllowance({ exempt: false, budget: { monthlyUsdMicros: USD(1), autoPause: true }, spentMicros: USD(2), now: NOW, credits: credits() })
    assert.equal(b.source, 'ai_budget')
  })
  it('a meter that cannot be read answers and alerts the platform owner; no pause without a saved rate', () => {
    const src = read('src/lib/soft-ai/ai-allowance.ts')
    assert.ok(src.includes('if (credits.failedOpen) void readers.alert(now.getTime())'))
    assert.ok(src.includes('alert: (nowMs) => alertCreditMeterDown(nowMs),'))
    assert.ok(src.includes("where: { tenantId, role: 'OWNER', isActive: true, invitedBy: null, invitedAt: null, user: { isSuperAdmin: true, active: true } },"))
    // An owner read error counts as the owner's business: answer, never a silent stop.
    assert.match(src, /owner read failed[^\n]*\n\s*void alertCreditMeterDown\(nowMs\)\n\s*return true/)
    const billing = read('src/lib/ai-billing/allowance.ts')
    assert.ok(billing.includes('const configured = (await listRates()).some((r) => r.periodKey <= s.periodKey)'))
    assert.ok(billing.includes('const value: CreditAllowance = d.enforced && configured'))
    assert.ok(billing.includes('{ ...open(now), failedOpen: true }'))
  })
  it('a paused chat goes to a person with the AI-allowance hand-off (no reply, no model call)', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.ok(turn.includes("{ kind: 'handoff', reason: preModel.skipReason === 'chat_rate_limited' ? HANDOFF_REASON.chatLimit : HANDOFF_REASON.aiAllowance },"))
    assert.match(HANDOFF_REASON_LABELS.ai_allowance, /contestale vos/)
  })
})

describe('AI allowance: the combined live decision (resolveAiAllowance, readers injected)', () => {
  const open: AiAllowance = { source: 'none', enforce: false, limitMicros: null, spentMicros: 0, remainingMicros: null, periodKey: '2026-10', renewsAt: null, exhausted: false }
  const usedUp = { enforce: true, exhausted: true, cap: 'credit' as const, periodKey: '2026-10', renewsAt: new Date('2026-11-01T06:00:00Z') }
  const run = async (over: { budget?: AiAllowance; credits?: unknown; owner?: boolean | 'throw' }) => {
    const alerts: number[] = []
    const ownerCalls: string[] = []
    const a = await resolveAiAllowance('t-live', NOW, {
      budget: async () => over.budget ?? open,
      credits: async () => (over.credits === undefined ? usedUp : (over.credits as typeof usedUp | null)),
      ownerBusiness: async (t) => {
        ownerCalls.push(t)
        return over.owner === true
      },
      alert: async (ms) => {
        alerts.push(ms)
      },
    })
    return { a, alerts, ownerCalls }
  }
  it('used-up credits pause a regular business; the owner check runs only then', async () => {
    const { a, ownerCalls } = await run({})
    assert.equal(a.exhausted, true)
    assert.equal(a.source, 'credits')
    assert.deepEqual(ownerCalls, ['t-live'])
    const notUsed = await run({ credits: { ...usedUp, exhausted: false } })
    assert.equal(notUsed.a.exhausted, false)
    assert.deepEqual(notUsed.ownerCalls, [])
  })
  it('a super-admin-owned business answers', async () => {
    assert.equal((await run({ owner: true })).a.exhausted, false)
  })
  it('a meter read failure answers and alerts; no credits reader result answers', async () => {
    const failed = await run({ credits: { enforce: false, exhausted: false, cap: 'credit', periodKey: '2026-10', renewsAt: null, failedOpen: true } })
    assert.equal(failed.a.exhausted, false)
    assert.equal(failed.alerts.length, 1)
    assert.equal((await run({ credits: null })).a.exhausted, false)
  })
  it('an exhausted budget wins first (no credits / owner read needed)', async () => {
    const b = await run({ budget: { ...open, source: 'ai_budget', enforce: true, exhausted: true } })
    assert.equal(b.a.source, 'ai_budget')
    assert.deepEqual(b.ownerCalls, [])
  })
  it('the status page names the cap: the own limit says to raise it', () => {
    const src = read('src/lib/soft-ai/agent-status.ts')
    assert.ok(src.includes("if (input.budget.cap === 'limit') {"))
    assert.match(src, /Subí tu límite en Configuración › Uso de IA/)
    assert.ok(read('src/lib/soft-ai/agent-status-server.ts').includes("cap: allowance.source === 'credits' ? allowance.cap : undefined"))
    const billing = read('src/lib/ai-billing/allowance.ts')
    assert.ok(billing.includes('const configured = (await listRates()).some((r) => r.periodKey <= s.periodKey)'))
    assert.ok(billing.includes('{ ...hit.value, failedOpen: true }'))
  })
})

describe('SecureDog #127 fixes', () => {
  const open: AiAllowance = { source: 'none', enforce: false, limitMicros: null, spentMicros: 0, remainingMicros: null, periodKey: '2026-10', renewsAt: null, exhausted: false }
  const readers = (credits: unknown, budget: AiAllowance = open) => ({
    budget: async () => budget,
    credits: async () => credits as never,
    ownerBusiness: async () => false,
    alert: async () => undefined,
  })
  it('#2 the per-chat cap applies only while a business-wide pause is possible', async () => {
    const live = { enforce: true, exhausted: false, cap: 'credit' as const, periodKey: '2026-10', renewsAt: null }
    assert.equal((await resolveAiAllowance('t', NOW, readers(live))).guarded, true)
    assert.equal((await resolveAiAllowance('t', NOW, readers({ ...live, enforce: false }))).guarded, false)
    assert.equal((await resolveAiAllowance('t', NOW, readers(null))).guarded, false)
    assert.equal((await resolveAiAllowance('t', NOW, readers(null, { ...open, source: 'ai_budget', enforce: true }))).guarded, true)
    const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
    assert.ok(gates.includes('export const CHAT_MODEL_TURNS_PER_HOUR = 30'))
    assert.ok(gates.includes("if (over) return { ok: false, status: 'skipped', skipReason: 'chat_rate_limited' }"))
    assert.match(gates, /chatOverModelCap\(input\.tenantId, input\.conversationId\)\.catch\(\(error\) => \{[\s\S]{0,200}return false/)
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.ok(turn.includes('    conversationId: row.conversationId,\n  })') || turn.includes('    conversationId: row.conversationId,\r\n  })'))
    assert.ok(turn.includes("preModel.skipReason === 'chat_rate_limited' ? HANDOFF_REASON.chatLimit : HANDOFF_REASON.aiAllowance"))
    assert.equal(normalizeHandoffReason('chat_limit', 'handoff'), 'chat_limit')
    assert.match(HANDOFF_REASON_LABELS.chat_limit, /contestale vos/)
  })
  it('#1 only the OWNER row created at sign-up counts as a super admin\'s business', () => {
    const src = read('src/lib/soft-ai/ai-allowance.ts')
    assert.ok(src.includes("where: { tenantId, role: 'OWNER', isActive: true, invitedBy: null, invitedAt: null, user: { isSuperAdmin: true, active: true } },"))
    // r2 A: old rows (before invites were recorded) must also have been written with the business.
    assert.ok(src.includes('Math.abs(r.joinedAt.getTime() - r.tenant.createdAt.getTime()) <= SIGNUP_ROW_WINDOW_MS'))
    assert.ok(src.includes('const SIGNUP_ROW_WINDOW_MS = 5 * 60_000'))
  })
  it('r2 B/D: the per-chat cap counts real model runs (tokens), also a reply dropped as a repeat; r2 C: a failed alert retries in ~5 min', () => {
    const gates = read('src/lib/soft-ai/agent-claim-gates.ts')
    assert.ok(gates.includes("const live = { tenantId, conversationId, mode: { not: 'test' }, inputTokens: { gt: 0 } }"))
    assert.ok(!gates.includes("status: { notIn: ['skipped'] } }\n  const [hour"))
    assert.ok(gates.includes("chat cap count failed"))
    assert.ok(read('src/lib/soft-ai/ai-allowance.ts').includes("else if (result === 'failed') lastMeterAlertAt = nowMs - 55 * 60_000"))
  })
  it('#4 a stale "used up" is not served on a read error; #5 the alert slot is used only when sent', () => {
    const billing = read('src/lib/ai-billing/allowance.ts')
    assert.ok(billing.includes('(!hit.value.exhausted || now.getTime() - hit.at < STALE_PAUSE_MS)'))
    assert.ok(billing.includes('const STALE_PAUSE_MS = 2 * 60_000'))
    assert.ok(read('src/lib/soft-ai/ai-allowance.ts').includes("if (result === 'sent') lastMeterAlertAt = nowMs"))
  })
})
