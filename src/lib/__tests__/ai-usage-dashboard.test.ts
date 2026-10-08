import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { budgetAlertLevel } from '@/lib/ai-usage-admin/budgets'

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
  it('filters are validated and always bound as parameters (never interpolated)', () => {
    assert.match(route, /const ID_RE = \/\^\[A-Za-z0-9_-\]\{1,64\}\$\//)
    assert.match(summary, /parts\.push\(`"tenantId" = \$\$\{i\+\+\}`\)/)
    assert.match(summary, /prisma\.\$queryRawUnsafe<Row\[\]>\(sql, \.\.\.params\)/)
    assert.doesNotMatch(summary, /\$\{f\.(tenantId|model|feature)\}/)
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
    assert.match(budgets, /if \(level === 100 && b\.autoPause && b\.scope !== 'global'\)/)
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
