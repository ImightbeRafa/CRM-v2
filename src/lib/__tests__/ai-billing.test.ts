/**
 * Lane H part 2: AI credits. Pure money rules (rounding, IVA once, settle, caps, webhook decision) plus source-level
 * guards on the payment / credit routes (tenant from session, server price, signature first, exactly-once writes).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  BILLABLE_FEATURES,
  DEFAULT_RATE,
  billedFromList,
  decideCredits,
  decidePurchaseWebhook,
  effectiveLimit,
  formatMarkup,
  formatUsdMicros,
  isBillableFeature,
  listFromBilled,
  nextPeriodKey,
  normalizePacks,
  quotePack,
  rateForPeriod,
  settleAmount,
} from '../ai-billing/math'
import { buildUsageReport } from '../ai-billing/report'

const read = (rel: string) => fs.readFileSync(rel, 'utf8').replace(/\r\n/g, '\n')
const USD = 1_000_000

test('billed = ceil(list × markup) on the total; inverse never over-grants', () => {
  assert.equal(billedFromList(0, 20_000), 0)
  assert.equal(billedFromList(1, 20_000), 2)
  assert.equal(billedFromList(1, 15_000), 2) // 1.5 → 2 (ceil)
  assert.equal(billedFromList(3, 13_333), 4) // 3.9999 → 4
  assert.equal(billedFromList(-50, 20_000), 0)
  // Markup below ×1 is never applied (selling under cost).
  assert.equal(billedFromList(100, 5_000), 100)
  // Large months keep exact integers (BigInt path).
  assert.equal(billedFromList(4_503_599_627_370, 20_000), 9_007_199_254_740)
  for (const billed of [0, 1, 2, 3, 999, 1_000_001, 12_345_679]) {
    for (const bps of [10_000, 13_000, 15_000, 20_000, 27_500]) {
      const list = listFromBilled(billed, bps)
      assert.ok(billedFromList(list, bps) <= billed + 1, `list ${list} for billed ${billed} @${bps}`)
      assert.ok(list * bps <= billed * 10_000, 'inverse is a floor')
    }
  }
})

test('month total is rounded once, not per event (no drift)', () => {
  const events = Array.from({ length: 1000 }, () => 1) // 1000 events of 1 list micro at ×1.5
  const perEvent = events.reduce((s, e) => s + billedFromList(e, 15_000), 0)
  const once = billedFromList(events.reduce((s, e) => s + e, 0), 15_000)
  assert.equal(perEvent, 2000)
  assert.equal(once, 1500)
})

test('IVA is charged once, on the pack price; the credit is the pre-IVA amount', () => {
  assert.deepEqual(quotePack({ id: 'p10', creditCents: 1_000 }), { packId: 'p10', priceCents: 1_000, ivaCents: 130, totalCents: 1_130, creditMicros: 10 * USD })
  assert.deepEqual(quotePack({ id: 'p25', creditCents: 2_500 }), { packId: 'p25', priceCents: 2_500, ivaCents: 325, totalCents: 2_825, creditMicros: 25 * USD })
  // Half-cent IVA rounds half-up: $5.50 → 71.5¢ → 72¢.
  assert.equal(quotePack({ id: 'x', creditCents: 550 }).ivaCents, 72)
})

test('packs: owner list is validated (ids, bounds, duplicates, count)', () => {
  assert.deepEqual(normalizePacks([{ id: 'p1', creditCents: 1000 }]), [{ id: 'p1', creditCents: 1000 }])
  assert.equal(normalizePacks([]), null)
  assert.equal(normalizePacks([{ id: 'p1', creditCents: 499 }]), null)
  assert.equal(normalizePacks([{ id: 'p1', creditCents: 100_001 }]), null)
  assert.equal(normalizePacks([{ id: 'p1', creditCents: 10.5 }]), null)
  assert.equal(normalizePacks([{ id: 'p1', creditCents: 1000 }, { id: 'p1', creditCents: 2000 }]), null)
  assert.equal(normalizePacks([{ id: 'P 1', creditCents: 1000 }]), null)
  assert.equal(normalizePacks(Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, creditCents: 1000 }))), null)
})

test('rates are not retroactive: a month is priced by the newest row starting on or before it', () => {
  const rows = [
    { periodKey: '2026-11', markupBps: 25_000, freeMonthlyMicros: 2 * USD },
    { periodKey: '2026-10', markupBps: 20_000, freeMonthlyMicros: 1 * USD },
  ]
  assert.equal(rateForPeriod(rows, '2026-09'), DEFAULT_RATE)
  assert.equal(rateForPeriod(rows, '2026-10').markupBps, 20_000)
  assert.equal(rateForPeriod(rows, '2026-11').markupBps, 25_000)
  assert.equal(rateForPeriod(rows, '2027-03').markupBps, 25_000)
  assert.equal(nextPeriodKey('2026-12'), '2027-01')
  assert.equal(nextPeriodKey('2026-09'), '2026-10')
})

test('settle: free credit first, then the balance, never below zero', () => {
  assert.deepEqual(settleAmount({ billedMicros: 800_000, freeMicros: USD, balanceBeforeMicros: 5 * USD }), { overageMicros: 0, amountMicros: -0, forgivenMicros: 0 })
  assert.deepEqual(settleAmount({ billedMicros: 3 * USD, freeMicros: USD, balanceBeforeMicros: 5 * USD }), { overageMicros: 2 * USD, amountMicros: -2 * USD, forgivenMicros: 0 })
  // Soft-cap overshoot past the balance is forgiven, never a debt.
  assert.deepEqual(settleAmount({ billedMicros: 7 * USD, freeMicros: USD, balanceBeforeMicros: 5 * USD }), { overageMicros: 6 * USD, amountMicros: -5 * USD, forgivenMicros: USD })
  assert.deepEqual(settleAmount({ billedMicros: 7 * USD, freeMicros: USD, balanceBeforeMicros: -3 }), { overageMicros: 6 * USD, amountMicros: -0, forgivenMicros: 6 * USD })
})

test('caps: tighter of credit / limit wins; limit clamped to the owner ceiling; alerts at 80 / 100', () => {
  const base = { freeMicros: USD, balanceMicros: 9 * USD, ceilingMicros: null, enforce: true, exempt: false }
  let d = decideCredits({ ...base, billedMicros: 4 * USD, limitMicros: 5 * USD })
  assert.equal(d.cap, 'limit')
  assert.equal(d.remainingMicros, USD)
  assert.equal(d.alert, 80)
  assert.equal(d.exhausted, false)
  d = decideCredits({ ...base, billedMicros: 5 * USD, limitMicros: 5 * USD })
  assert.equal(d.alert, 100)
  assert.equal(d.exhausted, true)
  d = decideCredits({ ...base, billedMicros: 10 * USD, limitMicros: null })
  assert.equal(d.cap, 'credit')
  assert.equal(d.creditMicros, 10 * USD)
  assert.equal(d.exhausted, true)
  // Regular account with only the free credit.
  d = decideCredits({ ...base, balanceMicros: 0, billedMicros: 700_000, limitMicros: null })
  assert.equal(d.usedPct, 70)
  assert.equal(d.alert, 0)
  assert.equal(effectiveLimit(50 * USD, 20 * USD), 20 * USD)
  assert.equal(effectiveLimit(null, 20 * USD), 20 * USD)
  assert.equal(effectiveLimit(5 * USD, null), 5 * USD)
  assert.equal(effectiveLimit(0, null), null)
})

test('nothing pauses when enforcement is off or the business is exempt (the owner)', () => {
  const over = { billedMicros: 50 * USD, freeMicros: USD, balanceMicros: 0, limitMicros: USD, ceilingMicros: null }
  assert.equal(decideCredits({ ...over, enforce: false, exempt: false }).exhausted, false)
  assert.equal(decideCredits({ ...over, enforce: true, exempt: true }).exhausted, false)
  assert.equal(decideCredits({ ...over, enforce: true, exempt: false }).exhausted, true)
})

test('webhook decision: unknown, replay, decline, wrong amount / currency / missing tx never credit', () => {
  const pending = { status: 'pending', totalCents: 1_130 }
  const ok = { approved: true, declined: false, amountCents: 1_130, currency: 'USD', transactionId: 't1' }
  assert.equal(decidePurchaseWebhook({ ...ok, purchase: null }), 'unknown_ref')
  assert.equal(decidePurchaseWebhook({ ...ok, purchase: pending }), 'credit')
  assert.equal(decidePurchaseWebhook({ ...ok, purchase: { status: 'paid', totalCents: 1_130 } }), 'already_paid')
  assert.equal(decidePurchaseWebhook({ ...ok, purchase: { status: 'failed', totalCents: 1_130 } }), 'credit')
  assert.equal(decidePurchaseWebhook({ ...ok, amountCents: 1_000, purchase: pending }), 'mismatch')
  assert.equal(decidePurchaseWebhook({ ...ok, amountCents: 11.3, purchase: pending }), 'mismatch')
  assert.equal(decidePurchaseWebhook({ ...ok, currency: 'CRC', purchase: pending }), 'mismatch')
  assert.equal(decidePurchaseWebhook({ ...ok, transactionId: null, purchase: pending }), 'mismatch')
  assert.equal(decidePurchaseWebhook({ ...ok, approved: false, declined: true, purchase: pending }), 'mark_failed')
  assert.equal(decidePurchaseWebhook({ ...ok, approved: false, declined: true, purchase: { status: 'failed', totalCents: 1_130 } }), 'ignore')
  assert.equal(decidePurchaseWebhook({ ...ok, approved: false, declined: false, purchase: pending }), 'ignore')
})

test('billable features: staff bot, tests, templates are included (never charged)', () => {
  for (const f of ['staff_bot', 'staff_bot_voice', 'agent_test', 'probar', 'template', 'transcription']) assert.equal(isBillableFeature(f), false, f)
  for (const f of BILLABLE_FEATURES) assert.equal(isBillableFeature(f), true)
  const report = buildUsageReport(
    [
      { day: '2026-10-01', feature: 'inbox_agent', agentId: 'a1', events: 10, listMicros: 300 },
      { day: '2026-10-01', feature: 'staff_bot', agentId: null, events: 4, listMicros: 900 },
      { day: '2026-10-02', feature: 'inbox_agent', agentId: 'a2', events: 5, listMicros: 101 },
      { day: '2026-10-02', feature: 'agent_test', agentId: 'a2', events: 50, listMicros: 5000 },
    ],
    { periodKey: '2026-10', markupBps: 20_000, freeMonthlyMicros: USD },
    '2026-10',
  )
  assert.equal(report.totals.billableListMicros, 401)
  assert.equal(report.totals.billedMicros, 802)
  assert.equal(report.totals.includedListMicros, 5900)
  assert.deepEqual(report.days.map((d) => d.billedMicros), [600, 202])
  assert.deepEqual(report.byAgent.map((a) => [a.agentId, a.billedMicros]), [['a1', 600], ['a2', 202]])
  assert.equal(report.byFeature.find((f) => f.feature === 'staff_bot')?.billedMicros, 0)
})

test('formatting', () => {
  assert.equal(formatUsdMicros(1_234_567), '$1.23')
  assert.equal(formatUsdMicros(4_200), '$0.0042')
  assert.equal(formatUsdMicros(-2 * USD), '-$2.00')
  assert.equal(formatMarkup(20_000), '×2')
  assert.equal(formatMarkup(15_000), '×1.5')
})

test('SQL 060: additive, RLS on every table, exactly-once keys, in the manifest', () => {
  const sql = read('supabase/migrations/060_ai_credits.sql')
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i)
  for (const t of ['AiBillingRate', 'AiBillingSettings', 'AiCreditLedger', 'AiCreditPurchase', 'AiTenantSpendLimit']) {
    assert.match(sql, new RegExp(String.raw`ALTER TABLE public\."${t}" ENABLE ROW LEVEL SECURITY`))
  }
  assert.match(sql, /CONSTRAINT "AiCreditLedger_sourceKey_key" UNIQUE \("sourceKey"\)/)
  assert.match(sql, /CONSTRAINT "AiCreditPurchase_ref_key" UNIQUE \("ref"\)/)
  assert.match(sql, /CONSTRAINT "AiCreditPurchase_transaction_key" UNIQUE \("transactionId"\)/)
  const manifest = read('scripts/lib/betsy-v2-additive-manifest.mjs')
  assert.match(manifest, /'060': '060_ai_credits\.sql'/)
  assert.doesNotMatch(read('prisma/schema.prisma'), /model AiCredit/, 'raw SQL only: no Prisma model (no db push)')
})

test('store: ledger writes are idempotent and purchases are paid by a status-guarded update in one transaction', () => {
  const s = read('src/lib/ai-billing/store.ts')
  const inserts = s.split('INSERT INTO "AiCreditLedger"').length - 1
  assert.equal(inserts, 3)
  assert.equal(s.split('ON CONFLICT ("sourceKey") DO NOTHING').length - 1, inserts, 'every ledger insert is idempotent')
  assert.match(s, /UPDATE "AiCreditPurchase" SET "status" = 'paid'[\s\S]*?WHERE "id" = \$\{p\.id\} AND "status" IN \('pending', 'failed'\)/)
  assert.match(s, /if \(updated !== 1\) return \{ result: 'already_paid' as const \}/)
  assert.match(s, /`purchase:\$\{p\.id\}`/)
  assert.match(s, /pg_advisory_xact_lock\(hashtext\(/)
  assert.match(s, /`usage:\$\{tenantId\}:\$\{p\}`/)
  assert.match(s, /const ref = `aicr_\$\{randomUUID\(\)\.replace\(\/-\/g, ''\)\}`/)
})

test('webhook route: signature before parsing, strict ref, 401 without secret, public in middleware', () => {
  const r = read('src/app/api/tilopay/webhook-ai-credits/route.ts')
  const verifyAt = r.indexOf('verifyWebhookSharedSecret(req, raw)')
  assert.ok(verifyAt > 0 && verifyAt < r.indexOf('JSON.parse(raw)'))
  assert.match(r, /\/\^aicr_\[a-f0-9\]\{32\}\$\//)
  assert.match(r, /status: 401/)
  assert.doesNotMatch(r, /body\.tenant/, 'the tenant comes from the stored purchase, never the payload')
  const mw = read('src/middleware.ts')
  assert.match(mw, /'\/api\/tilopay\/webhook-ai-credits',/)
})

test('tenant routes: tenant from the session, price from the server, owner-only writes, same origin', () => {
  const checkout = read('src/app/api/billing/ai-credits/checkout/route.ts')
  assert.match(checkout, /authenticateAPIWithPermission\(request, 'manage_billing', \{ skipBillingGuard: true \}\)/)
  assert.match(checkout, /isSameOriginRequest\(request\)/)
  assert.match(checkout, /z\.object\(\{ packId: z\.string\(\)/)
  assert.doesNotMatch(checkout, /body\.(amount|price|total)|parsed\.data\.(amount|price|total|tenantId)/)
  assert.match(checkout, /settings\.packs\.find\(\(p\) => p\.id === parsed\.data\.packId\)/)
  assert.match(checkout, /flag\?\.enabled !== true/, 'packs only for agent-enabled businesses')
  assert.match(checkout, /orderId: purchase\.ref/)
  const limit = read('src/app/api/billing/ai-limit/route.ts')
  assert.match(limit, /authenticateAPIWithPermission\(request, 'manage_billing'/)
  assert.match(limit, /isSameOriginRequest\(request\)/)
  assert.match(limit, /settings\.ceilingMicros !== null && micros > settings\.ceilingMicros/)
  const usage = read('src/app/api/billing/ai-usage/route.ts')
  for (const src of [checkout, limit, usage]) {
    assert.doesNotMatch(src, /searchParams\.get\('tenantId'\)|body\.tenantId|data\.tenantId/)
    assert.match(src, /auth\.tenantId/)
  }
  assert.match(usage, /auth\.role !== 'OWNER' && auth\.role !== 'ADMIN'/)
  const owner = read('src/app/api/super-admin/ai-billing/route.ts')
  assert.match(owner, /requireSuperAdmin\(request\)/)
  assert.equal((owner.match(/requireSuperAdmin\(request, \{ write: true \}\)/g) ?? []).length, 2)
})

test('allowance hook fails open and never enforces before SQL 060 / with enforcement off', () => {
  const a = read('src/lib/ai-billing/allowance.ts')
  assert.match(a, /catch \(error\)[\s\S]*?: open\(now\)/)
  assert.match(a, /d\.enforced\s*\?/)
  const st = read('src/lib/ai-billing/state.ts')
  assert.match(st, /enforce: ready && settings\.enforce/)
  assert.match(st, /exemptTenantIds\(\)\.has\(tenantId\)/)
})
