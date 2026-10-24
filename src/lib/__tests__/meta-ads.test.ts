/**
 * Meta ads_read (ad account connection + spend & ROAS). Pure rules + source guards (SecureDog / Advisor):
 * ads_read only, state bound to business + person, ad-account ids validated, revoke only ads_read, no paging.next,
 * tokens never in URLs / responses / logs, RLS on the new table, Spanish/English texts complete.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildAdsState,
  classifyGraphError,
  computeRoas,
  daysLeft,
  mapInsightRows,
  normalizeAdAccountId,
  parseFxRate,
  parseStoredAccounts,
  readAdsGrant,
  storedStatusFor,
  toAdAccountChoices,
  verifyAdsState,
} from '../meta-ads/core'
import { buildRoasReport } from '../meta-ads/roas'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

test('ad account ids: act_ prefix stripped, anything else rejected (never an unchecked id in a Graph path)', () => {
  assert.equal(normalizeAdAccountId('act_1234567890'), '1234567890')
  assert.equal(normalizeAdAccountId('987'), '987')
  for (const bad of ['', 'act_', 'act_12/../me', '12a', '1'.repeat(21), null, undefined, 'me']) assert.equal(normalizeAdAccountId(bad), null)
})

test('Graph errors → state: only token / permission problems are stored; rate limits are shown, never stored', () => {
  assert.equal(classifyGraphError({ code: 190 }), 'token_invalid')
  assert.equal(classifyGraphError({ code: 200 }), 'missing_permission')
  assert.equal(classifyGraphError({ code: 10 }), 'missing_permission')
  assert.equal(classifyGraphError({ code: 17 }), 'rate_limited')
  assert.equal(classifyGraphError({ code: 613 }), 'rate_limited')
  assert.equal(classifyGraphError({ code: 80004 }), 'rate_limited')
  assert.equal(classifyGraphError({ code: 100, error_subcode: 33 }), 'not_found')
  assert.equal(classifyGraphError({ code: 1 }), 'error')
  assert.equal(storedStatusFor('token_invalid'), 'token_invalid')
  assert.equal(storedStatusFor('rate_limited'), null)
  assert.equal(storedStatusFor('error'), null)
})

test('debug_token: ads_read must be granted; dialog picks filter the accounts; earliest expiry wins', () => {
  const g = readAdsGrant({
    scopes: ['ads_read', 'public_profile'],
    granular_scopes: [{ scope: 'ads_read', target_ids: ['act_111', '222', 'bad'] }],
    user_id: '10223344',
    expires_at: 2_000_000_000,
    data_access_expires_at: 1_900_000_000,
  })
  assert.equal(g.granted, true)
  assert.deepEqual(g.targetIds, ['111', '222'])
  assert.equal(g.metaUserId, '10223344')
  assert.equal(g.expiresAt?.getTime(), 1_900_000_000_000)
  assert.equal(readAdsGrant({ scopes: ['public_profile'] }).granted, false)
  assert.equal(readAdsGrant({ scopes: ['ads_read'], expires_at: 0 }).expiresAt, null)

  const rows = [
    { account_id: '111', name: 'Forge Ads', currency: 'usd', timezone_name: 'America/Costa_Rica' },
    { account_id: '222', name: '', currency: 'CRC' },
    { account_id: '333', name: 'Other business' },
    { account_id: '111', name: 'dup' },
  ]
  const picked = toAdAccountChoices(rows, ['111', '222'])
  assert.deepEqual(picked.map((a) => a.id), ['111', '222'])
  assert.equal(picked[0].currency, 'USD')
  assert.equal(picked[1].name, 'Cuenta 222')
  assert.equal(toAdAccountChoices(rows, null).length, 3)
  assert.deepEqual(parseStoredAccounts(JSON.stringify(picked)).map((a) => a.id), ['111', '222'])
  assert.deepEqual(parseStoredAccounts('not json'), [])
})

test('OAuth state is bound to the business and the person who started it', () => {
  const { state, cookie } = buildAdsState('s3cret', 'abc123', 'tenantA', 'user1')
  assert.equal(state, 'abc123')
  assert.equal(verifyAdsState('s3cret', state, cookie, 'tenantA', 'user1'), true)
  assert.equal(verifyAdsState('s3cret', state, cookie, 'tenantB', 'user1'), false, 'tenant switched mid-flow')
  assert.equal(verifyAdsState('s3cret', state, cookie, 'tenantA', 'user2'), false)
  assert.equal(verifyAdsState('s3cret', 'other', cookie, 'tenantA', 'user1'), false)
  assert.equal(verifyAdsState('', state, cookie, 'tenantA', 'user1'), false)
  assert.equal(verifyAdsState('s3cret', state, 'nodot', 'tenantA', 'user1'), false)
})

test('insights rows: per ad, numbers parsed, bad ids dropped, duplicates summed', () => {
  const rows = mapInsightRows([
    { ad_id: '120252080104160356', ad_name: 'Pack 2', adset_name: 'CR 25-45', campaign_name: 'Forge Oct', spend: '12.50', impressions: '1000', clicks: '40' },
    { ad_id: '120252080104160356', spend: '2.50', impressions: '200', clicks: '5' },
    { ad_id: 'x', spend: '9' },
    { ad_id: '120252080104160999', spend: 'NaN', impressions: '-3' },
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { adId: '120252080104160356', adName: 'Pack 2', adsetName: 'CR 25-45', campaignName: 'Forge Oct', spend: 15, impressions: 1200, clicks: 45 })
  assert.equal(rows[1].spend, 0)
  assert.equal(rows[1].impressions, 0)
})

test('ROAS: same currency direct; other currency only with the owner rate; no spend → —', () => {
  assert.deepEqual(computeRoas({ revenue: 300, spend: 100, storeCurrency: 'CRC', adCurrency: 'CRC', fxRate: null }), { roas: 3, reason: 'ok' })
  assert.deepEqual(computeRoas({ revenue: 51000, spend: 100, storeCurrency: 'CRC', adCurrency: 'USD', fxRate: null }), { roas: null, reason: 'currency_mismatch' })
  assert.deepEqual(computeRoas({ revenue: 51000, spend: 100, storeCurrency: 'CRC', adCurrency: 'USD', fxRate: 510 }), { roas: 1, reason: 'ok' })
  assert.deepEqual(computeRoas({ revenue: 500, spend: 0, storeCurrency: 'CRC', adCurrency: 'CRC', fxRate: null }), { roas: null, reason: 'no_spend' })
  assert.equal(parseFxRate('510,5'), 510.5)
  assert.equal(parseFxRate(''), null)
  assert.equal(parseFxRate(-1), null)
  assert.equal(parseFxRate('1e9'), null)
})

test('ROAS report: joined by ad id, spend-only and orders-only ads both listed, totals and revenue mode', () => {
  const sale = (adId: string, booked: number, collected: number, orders: number) => ({
    key: adId, adId, headline: `H ${adId}`, sourceUrl: null, campaignName: null, platforms: ['whatsapp' as const],
    chats: 3, orders, paidOrders: orders, booked, collected, conversion: null,
  })
  const report = buildRoasReport({
    sales: { rows: [sale('1001', 60000, 50000, 2), sale('1003', 20000, 20000, 1)] },
    spend: [
      { adId: '1001', adName: 'A', adsetName: 'S', campaignName: 'C', spend: 20000, impressions: 900, clicks: 30 },
      { adId: '1002', adName: 'B', adsetName: null, campaignName: 'C', spend: 10000, impressions: 400, clicks: 4 },
    ],
    revenueMode: 'collected',
    storeCurrency: 'CRC',
    adCurrency: 'CRC',
    fxRate: null,
  })
  assert.deepEqual(report.rows.map((r) => r.adId), ['1001', '1002', '1003'])
  assert.equal(report.rows[0].revenue, 50000)
  assert.equal(report.rows[0].roas, 2.5)
  assert.equal(report.rows[1].orders, 0)
  assert.equal(report.rows[1].roas, 0)
  assert.equal(report.rows[2].spend, 0)
  assert.equal(report.rows[2].roas, null)
  assert.equal(report.rows[2].headline, 'H 1003')
  assert.equal(report.totals.spend, 30000)
  // Totals only over ads with spend in the connected account; ad 1003 (sales, no spend here) is shown apart.
  assert.equal(report.totals.revenue, 50000)
  assert.equal(Math.round((report.totals.roas ?? 0) * 100) / 100, 1.67)
  assert.deepEqual(report.withoutSpend, { ads: 1, orders: 1, revenue: 20000 })
  assert.equal(report.roasReason, 'ok')
})

test('days left on the token', () => {
  const now = new Date('2026-10-23T00:00:00Z')
  assert.equal(daysLeft(new Date('2026-10-30T12:00:00Z'), now), 7)
  assert.equal(daysLeft(new Date('2026-10-01T00:00:00Z'), now), 0)
  assert.equal(daysLeft(null, now), null)
})

test('security guards (source): ads_read only, POST secrets, header tokens, cursor paging, revoke only ads_read', () => {
  const graph = read('src/lib/meta-ads/graph.ts')
  assert.match(graph, /headers: \{ Authorization: `Bearer \$\{token\}` \}/)
  assert.match(graph, /redirect: 'error'/)
  assert.match(graph, /AbortSignal\.timeout\(TIMEOUT_MS\)/)
  assert.match(graph, /purpose: 'whatsapp'/, 'appsecret_proof with the Inbox app secret')
  assert.doesNotMatch(graph, /fetchImpl\([^)]*paging/, 'paging.next is never fetched')
  assert.match(graph, /after \? \{ \.\.\.params, after \} : params/)
  assert.match(graph, /`\$\{who\}\/permissions\/ads_read`/, 'revoke names the permission')
  assert.doesNotMatch(graph, /buildMetaGraphUrl\(`[^`]*\/permissions`\)/, 'never DELETE /me/permissions without a permission')
  assert.match(graph, /method: 'POST', headers: \{ 'Content-Type': 'application\/x-www-form-urlencoded' \}, body:/)
  assert.doesNotMatch(graph, /console\.[a-z]+\([^)]*(token|url|secret)/i, 'no tokens / urls in logs')

  const authUrl = read('src/app/api/auth/meta-ads/auth-url/route.ts')
  assert.match(authUrl, /params\.set\('scope', ADS_READ_SCOPE\)/)
  assert.doesNotMatch(authUrl, /ads_management|pages_|instagram_|whatsapp_/)
  assert.match(authUrl, /authenticateAPIWithPermission\(request, 'update_config'\)/)
  assert.match(authUrl, /buildAdsState\(secret, randomBytes\(24\)\.toString\('hex'\), auth\.tenantId as string, auth\.userId as string\)/)
  assert.match(read('src/lib/meta-ads/core.ts'), /export const ADS_READ_SCOPE = 'ads_read'/)

  const callback = read('src/app/api/auth/meta-ads/callback/route.ts')
  assert.match(callback, /verifyAdsState\(secret, stateParam, cookie, tenantId, userId\)/)
  assert.ok(callback.indexOf('verifyAdsState(') < callback.indexOf('exchangeAdsCode('), 'state checked before any Meta call')
  assert.match(callback, /if \(!grant\.granted\) return back\(request, 'no_permission'\)/)
  assert.doesNotMatch(callback, /accessToken[^\n]*NextResponse\.json|console\.[a-z]+\([^)]*token/i)

  const config = read('src/app/api/config/meta-ads/route.ts')
  assert.doesNotMatch(config, /accessToken|readAdToken/, 'the token never reaches the card')
  assert.match(config, /accounts: c\.status === 'pending_pick' \?/, 'account list only while picking')
  for (const m of ['POST', 'DELETE']) assert.match(config, new RegExp(`export async function ${m}\\(request: NextRequest\\) \\{\\n  if \\(!isSameOriginJson\\(request\\)\\)`))
  assert.match(read('src/lib/meta-ads/store.ts'), /const choice = id \? current\.accounts\.find\(\(a\) => a\.id === id\) : undefined/, 'pick only a listed account')
  assert.match(read('src/lib/meta-ads/store.ts'), /encryptSocialAccessToken\(input\.token\)/)
})

test('SQL 064: additive, RLS on, gated, not in the Prisma schema; insights cache keyed by ad account', () => {
  const sql = read('supabase/migrations/064_meta_ad_connection.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."MetaAdConnection"/)
  assert.match(sql, /ALTER TABLE public\."MetaAdConnection" ENABLE ROW LEVEL SECURITY;/)
  assert.doesNotMatch(sql, /DROP |TRUNCATE|DELETE FROM|FORCE ROW/i)
  assert.doesNotMatch(read('prisma/schema.prisma'), /MetaAdConnection/)
  assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'064': '064_meta_ad_connection\.sql'/)
  assert.match(read('src/lib/meta-ads/insights.ts'), /const key = `\$\{tenantId\}\|\$\{connection\.adAccountId\}\|\$\{range\.startDate\}\|\$\{range\.endDate\}`/)
})

test('ES / EN texts: every key exists in both languages; Spanish by default', async () => {
  const src = read('src/lib/meta-ads/i18n.ts')
  assert.match(src, /useState<AdsLang>\('es'\)/)
  const es = src.slice(src.indexOf('const ES = {'), src.indexOf('const EN: typeof ES'))
  const en = src.slice(src.indexOf('const EN: typeof ES'))
  const keys = (block: string) => [...block.matchAll(/^  ([a-zA-Z]+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(en), keys(es))
  assert.match(read('src/components/insights/AdSalesView.tsx'), /<AdRoasCard query=\{range \? query : null\} \/>/)
  assert.match(read('src/app/config/social/page.tsx'), /<MetaAdAccountCard \/>/)
  assert.doesNotMatch(read('src/app/config/social/components/MetaAdAccountCard.tsx'), /window\.(confirm|alert)\(/)
})

test('Verifier fixes stay fixed: relative redirect, Worker env, fresh fx, names never flip the state, disconnect always allowed', () => {
  const callback = read('src/app/api/auth/meta-ads/callback/route.ts')
  assert.match(callback, /headers: \{ Location: `\/config\/social\?ads=\$\{encodeURIComponent\(result\)\}#cuenta-publicitaria`/)
  assert.doesNotMatch(callback, /NextResponse\.redirect\(new URL\([^)]*request\.url/, 'no 0.0.0.0 redirect from the container')
  assert.match(callback, /if \(!debug\.ok\) return back\(request, 'error'\)/)
  const worker = read('src/cf-container-worker.ts')
  assert.match(worker, /META_ADS_LOGIN_CONFIG_ID\?: string;/)
  assert.match(worker, /\n  "META_ADS_LOGIN_CONFIG_ID",\n/)
  const insights = read('src/lib/meta-ads/insights.ts')
  assert.match(insights, /\{ \.\.\.hit\.value, connection \}/, 'cached numbers, fresh connection (exchange rate)')
  const names = insights.slice(insights.indexOf('export async function loadAdNames'))
  assert.doesNotMatch(names, /markAdConnectionProblem/, 'a name lookup never changes the connection state')
  const config = read('src/app/api/config/meta-ads/route.ts')
  assert.match(config, /await setAdFxRate\(tenantId, body\.rate\)\n      clearAdSpendCache\(tenantId\)/)
  assert.match(config, /authenticateAPIWithPermission\(request, 'update_config', \{ skipBillingGuard: true \}\)/)
  // SecureDog: token wiped on token / permission problems, account list cleared after the pick, revoke only when
  // no other business uses the same Facebook person, never save without the Meta user id, GET for update_config.
  const store = read('src/lib/meta-ads/store.ts')
  assert.match(store, /SET "status" = \$\{status\}, "accessToken" = '',/)
  assert.match(store, /"accounts" = '\[\]'::jsonb/)
  assert.match(config, /if \(removed\?\.token && shared === 0\) await revokeAdsRead/)
  assert.match(config, /export async function GET[\s\S]*?authenticateAPIWithPermission\(request, 'update_config'\)/)
  assert.match(callback, /if \(!metaUserId\) return back\(request, 'error'\)/)
  const deletion = read('src/lib/meta-data-deletion/core.ts')
  assert.ok(deletion.indexOf('store.deleteAdConnections(') < deletion.indexOf('store.findRecentRequest('), 'ad delete runs on a resend too')
  assert.equal(verifyAdsState('s', 'é'.repeat(4), 'éééé.x', 't', 'u'), false, 'multi-byte state fails, never throws')
})
