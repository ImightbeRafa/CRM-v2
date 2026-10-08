import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { budgetAlertLevel, shouldPause } from '@/lib/ai-usage-admin/budgets'
import { costaRicaMonthKey } from '@/lib/ai-usage-admin/summary'

const read = (p: string) => readFileSync(p, 'utf8')

describe('AI budgets: alert once per threshold per month', () => {
  const base = { budgetMicros: 100_000_000, month: '2026-10', alertedMonth: null as string | null, alertedPct: 0 }
  it('80% and 100% thresholds', () => {
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 79_000_000 }), 0)
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 80_000_000 }), 80)
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 120_000_000 }), 100)
  })
  it('already alerted this month → quiet; a new month resets', () => {
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 90_000_000, alertedMonth: '2026-10', alertedPct: 80 }), 0)
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 100_000_000, alertedMonth: '2026-10', alertedPct: 80 }), 100)
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 100_000_000, alertedMonth: '2026-10', alertedPct: 100 }), 0)
    assert.equal(budgetAlertLevel({ ...base, spentMicros: 90_000_000, alertedMonth: '2026-09', alertedPct: 100 }), 80)
  })
})

describe('owner AI usage dashboard', () => {
  const route = read('src/app/api/super-admin/ai-usage/route.ts')
  const summary = read('src/lib/ai-usage-admin/summary.ts')
  it('only Betsy platform admins (others get 404); budget writes are same-origin and audited', () => {
    assert.match(route, /if \(!\(await isSuperAdmin\(auth\.userId\)\)\) \{\s*return \{ denied: NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404/)
    assert.match(route, /export async function PUT[\s\S]*isSameOriginRequest\(request\)/)
    assert.match(route, /entityType: 'ai_budget'/)
    assert.match(read('src/app/super-admin/ia/page.tsx'), /if \(!\(await isSuperAdmin\(userId\)\)\) redirect\('\/dashboard'\)/)
  })
  it('filters are validated and always bound; every query goes through the analytics guard', () => {
    assert.match(route, /const ID_RE = \/\^\[A-Za-z0-9_-\]\{1,64\}\$\//)
    // Prisma.sql template values are bound parameters, never pasted into the SQL text
    assert.ok(summary.includes('if (f.tenantId) parts.push(Prisma.sql`"tenantId" = ${f.tenantId}`)'))
    assert.doesNotMatch(summary, /queryRawUnsafe/)
    assert.ok(summary.includes('const q = (sql: Prisma.Sql) => queryWithTimeout<Row[]>(sql)'))
    assert.match(route, /if \(error instanceof AnalyticsBusyError\) return busy\(\)/)
  })
  it('aggregates only: no message text, every AI feature labeled', () => {
    assert.doesNotMatch(summary, /"content"|outputText|"text"/)
    for (const f of ['inbox_agent', 'probar', 'agent_test', 'customer_paste', 'staff_bot', 'staff_bot_voice', 'transcription', 'vision']) {
      assert.match(summary, new RegExp(`${f}: '`), f)
    }
  })
  it('budget check runs every 5 minutes from the Worker cron and can pause one business', () => {
    assert.match(read('src/cf-container-worker.ts'), /"\*\/5 \* \* \* \*": \[[^\]]*"\/api\/cron\/ai-budget"\]/)
    assert.match(read('src/app/api/cron/ai-budget/route.ts'), /requireCronBearer\(request\)/)
    const budgets = read('src/lib/ai-usage-admin/budgets.ts')
    assert.ok(budgets.includes('if (shouldPause({ scope: b.scope, autoPause: b.autoPause'))
    assert.match(budgets, /key: killTenantKey\(b\.scope\)/)
  })
  it('SQL 051 is additive, RLS on, registered; backfill is idempotent and host-confirmed', () => {
    const sql = read('supabase/migrations/051_ai_budget.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."AiBudget"/)
    assert.match(sql, /ALTER TABLE public\."AiBudget" ENABLE ROW LEVEL SECURITY/)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'051': '051_ai_budget\.sql'/)
    const backfill = read('scripts/ai-usage-backfill.mjs')
    assert.match(backfill, /ON CONFLICT \("sourceKey"\) DO NOTHING/)
    assert.match(backfill, /AI_USAGE_BACKFILL_CONFIRM_HOST/)
    assert.match(backfill, /WHERE t\."createdAt" < \$\{cutover\}/)
  })
})

describe('F2 review fixes', () => {
  const route = readFileSync('src/app/api/super-admin/ai-usage/route.ts', 'utf8')
  const budgets = readFileSync('src/lib/ai-usage-admin/budgets.ts', 'utf8')
  it('months are Costa Rica months', () => {
    // 2026-10-31 20:00 in Costa Rica is 2026-11-01 02:00 UTC
    assert.equal(costaRicaMonthKey(new Date('2026-11-01T02:00:00Z')), '2026-10')
    assert.equal(costaRicaMonthKey(new Date('2026-11-01T07:00:00Z')), '2026-11')
  })
  it('pause: only at 100% with auto-pause, once per month, never for the global budget', () => {
    const b = { scope: 't1', autoPause: true, spentMicros: 100, budgetMicros: 100, pausedMonth: null as string | null, month: '2026-10' }
    assert.equal(shouldPause(b), true)
    assert.equal(shouldPause({ ...b, spentMicros: 99 }), false)
    assert.equal(shouldPause({ ...b, autoPause: false }), false)
    assert.equal(shouldPause({ ...b, pausedMonth: '2026-10' }), false)
    assert.equal(shouldPause({ ...b, scope: 'global' }), false)
  })
  it('a failed pause is retried; alerts only count when delivered; the business team is told', () => {
    assert.ok(budgets.includes('await prisma.$executeRaw`UPDATE "AiBudget" SET "pausedMonth" = ${month} WHERE "scope" = ${b.scope}`'))
    assert.ok(budgets.includes("if (result === 'failed') continue"))
    assert.ok(budgets.includes('await notifyBusinessTeam(b.scope, month)'))
    assert.doesNotMatch(budgets, /writeAgentKill\([\s\S]{0,200}\.catch\(\(\) => \{\}\)/)
  })
  it('changing a budget resets the month markers; delete is explicit; budgets are read fresh', () => {
    assert.ok(budgets.includes('"alertedMonth" = CASE WHEN "AiBudget"."monthlyUsdMicros" <> EXCLUDED."monthlyUsdMicros"'))
    assert.match(route, /export async function DELETE/)
    assert.ok(route.includes('const budgets = await listAiBudgets()'))
    assert.ok(route.includes("if (!(typeof raw === 'number' && Number.isFinite(raw) && raw > 0))"))
  })
  it('CSV cells are formula-safe; opens are audited; audit rows go to the affected business', () => {
    const summary = readFileSync('src/lib/ai-usage-admin/summary.ts', 'utf8')
    assert.ok(summary.includes("import { csvCell } from '@/lib/csv-safe'"))
    assert.ok(route.includes('Abrió Uso de IA'))
    assert.ok(route.includes('tenantId: auditTenantFor(scope, auth.tenantId)'))
  })
  it('backfill: UTC cutover, skips its own rows, refuses an --until after the meter start', () => {
    const bf = readFileSync('scripts/ai-usage-backfill.mjs', 'utf8')
    assert.ok(bf.includes('to_char(MIN("createdAt")'))
    assert.ok(bf.includes(`"sourceKey" NOT LIKE 'turn:%'`))
    assert.ok(bf.includes("process.argv.includes('--force')"))
  })
})
