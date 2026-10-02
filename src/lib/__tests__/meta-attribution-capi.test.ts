import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { eventValue, isPaymentConfirmed, tenantCurrency } from '../meta-attribution/payment'
import { buildEventsBody, buildPurchaseEvent, classifyCapiError, purchaseEventId, retryDelayMs } from '../meta-attribution/capi-payload'
import { activeTestEventCode, parseSettings, senderSwitchOn } from '../meta-attribution/settings'
import { checkLineDataset, pickDatasetId } from '../meta-attribution/dataset'
import { sendPendingEvents } from '../meta-attribution/sender'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

test('a sale counts ONLY when payment is confirmed (Rafael 2026-10-02)', () => {
  const paid = { customFields: { paymentStatus: 'paid' } }
  assert.equal(isPaymentConfirmed({ status: 'Enviado' }), false, '"Enviado" alone is not a confirmed payment')
  assert.equal(isPaymentConfirmed({ status: 'Pendiente' }), false)
  assert.equal(isPaymentConfirmed({ status: 'Enviado', ...paid }), true)
  assert.equal(isPaymentConfirmed({ status: 'Entregado', contraEntrega: true }), false, 'cash on delivery not confirmed yet')
  assert.equal(isPaymentConfirmed({ status: 'Entregado', contraEntrega: true, cePaymentConfirmed: true }), true)
  assert.equal(isPaymentConfirmed({ status: 'Cancelado', ...paid }), false)
  assert.equal(isPaymentConfirmed({ status: 'Enviado', ...paid, deletedAt: new Date() }), false, 'archived')
  assert.equal(isPaymentConfirmed({ status: 'x', customFields: JSON.stringify({ payment_status: 'pagado' }) }), true)
})

test('colones and dollars (the business currency); anything else is skipped; amounts rounded', () => {
  assert.equal(tenantCurrency(null), 'CRC')
  assert.equal(tenantCurrency({ currency: 'usd' }), 'USD')
  assert.equal(tenantCurrency({ currency: 'EUR' }), null)
  assert.equal(eventValue(25000.4, 'CRC'), 25000)
  assert.equal(eventValue('49.999', 'USD'), 50)
  assert.equal(eventValue(0, 'CRC'), null)
  assert.equal(eventValue('abc', 'USD'), null)
})

test('event payload: click id + WhatsApp account only, never name / phone / email; one id per order', () => {
  const ev = buildPurchaseEvent({
    eventId: purchaseEventId('ord1'),
    eventTime: new Date('2026-10-02T10:00:00Z'),
    wabaId: '1234567890',
    ctwaClid: 'ARAkLk',
    value: 25000,
    currency: 'CRC',
  })
  assert.deepEqual(ev, {
    event_name: 'Purchase',
    event_time: 1790935200,
    event_id: 'betsy:order:ord1:Purchase',
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: { whatsapp_business_account_id: '1234567890', ctwa_clid: 'ARAkLk' },
    custom_data: { currency: 'CRC', value: 25000 },
  })
  assert.ok(!/"(ph|em|fn|ln)"/.test(JSON.stringify(ev)))
  assert.deepEqual(buildEventsBody([ev], null), { data: [ev], partner_agent: 'betsycrm' })
  assert.equal((buildEventsBody([ev], 'TEST1') as { test_event_code?: string }).test_event_code, 'TEST1')
})

test('Meta errors: token → pause line, permission → reconnect, limits / 5xx / network → retry, else fail', () => {
  assert.equal(classifyCapiError(400, 190), 'token_invalid')
  assert.equal(classifyCapiError(403, 10), 'missing_permission')
  assert.equal(classifyCapiError(403, 200), 'missing_permission')
  assert.equal(classifyCapiError(400, 4), 'retry')
  assert.equal(classifyCapiError(429, null), 'retry')
  assert.equal(classifyCapiError(503, null), 'retry')
  assert.equal(classifyCapiError(0, null), 'retry')
  assert.equal(classifyCapiError(400, 100), 'failed')
  assert.equal(retryDelayMs(1), 2 * 60_000)
  assert.equal(retryDelayMs(10), 64 * 60_000)
})

test('opt-in: never on without a recorded acknowledgement; test code expires; server switch is exactly "1"', () => {
  assert.equal(parseSettings({ enabled: true, config: {} }).enabled, false)
  assert.equal(parseSettings({ enabled: true, config: { acknowledgedAt: '2026-10-02T00:00:00Z' } }).enabled, true)
  assert.equal(parseSettings(null).enabled, false)
  const s = parseSettings({ enabled: true, config: { acknowledgedAt: 'x', testEventCode: 'TEST9', testEventCodeExpiresAt: '2026-10-02T12:00:00Z' } })
  assert.equal(activeTestEventCode(s, Date.parse('2026-10-02T11:00:00Z')), 'TEST9')
  assert.equal(activeTestEventCode(s, Date.parse('2026-10-02T13:00:00Z')), null)
  assert.equal(senderSwitchOn({}), false)
  assert.equal(senderSwitchOn({ META_SALES_CAPI_SENDER: 'true' }), false)
  assert.equal(senderSwitchOn({ META_SALES_CAPI_SENDER: '1' }), true)
})

test('sender is a hard no-op without the server switch (no DB, no network)', async () => {
  const saved = process.env.META_SALES_CAPI_SENDER
  delete process.env.META_SALES_CAPI_SENDER
  let called = false
  try {
    const r = await sendPendingEvents({ fetchImpl: (async () => { called = true; return new Response('{}') }) as unknown as typeof fetch })
    assert.equal(r.disabled, 'sender_switch_off')
    assert.equal(called, false)
  } finally {
    if (saved !== undefined) process.env.META_SALES_CAPI_SENDER = saved
  }
})

const ENV = { META_WA_APP_ID: '123456789012345', META_WA_APP_SECRET: 'a'.repeat(32) }
function graph(routes: Record<string, unknown>) {
  const calls: string[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(String(url))
    calls.push(`${init.method} ${u.pathname}`)
    const key = `${init.method} ${u.pathname.replace(/^\/v\d+\.\d+/, '')}`
    const body = routes[key] ?? { error: { code: 100 } }
    return new Response(JSON.stringify(body), { status: 'error' in (body as object) ? 400 : 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const line = { id: 'sa1', tenantId: 't1', wabaId: '1111111111', accessToken: 'plain-token' }

test('line check: permission missing → reconnect; existing dataset reused; new one created; bad token flagged', async () => {
  const noScope = graph({ 'GET /debug_token': { data: { is_valid: true, scopes: ['whatsapp_business_messaging'] } } })
  assert.equal((await checkLineDataset(line, { fetchImpl: noScope.fetchImpl, env: ENV })).status, 'missing_permission')
  assert.deepEqual(noScope.calls, ['GET /v24.0/debug_token'], 'no dataset call without the permission')

  const scopes = { data: { is_valid: true, scopes: ['whatsapp_business_manage_events'] } }
  const existing = graph({ 'GET /debug_token': scopes, 'GET /1111111111/dataset': { data: [{ id: '987654321' }] } })
  const r1 = await checkLineDataset(line, { fetchImpl: existing.fetchImpl, env: ENV })
  assert.deepEqual([r1.status, r1.datasetId], ['ready', '987654321'])
  assert.ok(!existing.calls.includes('POST /v24.0/1111111111/dataset'))

  const created = graph({ 'GET /debug_token': scopes, 'GET /1111111111/dataset': { data: [] }, 'POST /1111111111/dataset': { id: '555666777' } })
  const r2 = await checkLineDataset(line, { fetchImpl: created.fetchImpl, env: ENV })
  assert.deepEqual([r2.status, r2.datasetId], ['ready', '555666777'])

  const invalid = graph({ 'GET /debug_token': { data: { is_valid: false } } })
  assert.equal((await checkLineDataset(line, { fetchImpl: invalid.fetchImpl, env: ENV })).status, 'token_invalid')
  assert.equal((await checkLineDataset({ ...line, wabaId: null }, { fetchImpl: invalid.fetchImpl, env: ENV })).errorCode, 'line_not_ready')
  assert.equal(pickDatasetId({ id: 'abc' }), null)
})

test('sweep / sender / cron: tenant-scoped SQL, no secrets in logs, off-switch first, wired on Cloudflare only', () => {
  const sweep = read('src/lib/meta-attribution/sweep.ts')
  for (const t of ['ChatMessage" cm', 'ChatConversation" c', 'SocialAccount" s', 'ChatAdReferral" r', 'MetaConversionEvent" e']) {
    const after = sweep.slice(sweep.indexOf(t))
    assert.match(after.slice(0, 260), /"tenantId" = \$\{tenantId\}/, `tenant filter on ${t}`)
  }
  assert.match(sweep, /if \(!isPaymentConfirmed\(o\)\)/)
  assert.match(sweep, /ON CONFLICT \("tenantId", "eventId"\) DO NOTHING/)
  for (const f of ['src/lib/meta-attribution/sender.ts', 'src/lib/meta-attribution/dataset.ts', 'src/lib/meta-attribution/sweep.ts']) {
    const src = read(f)
    assert.doesNotMatch(src, /console\.[a-z]+\([^)]*(token|ctwaClid|accessToken)/i, f)
    assert.doesNotMatch(src, /from '@\/lib\/meta-capi'/, 'never the Betsy pixel module')
  }
  const cron = read('src/app/api/cron/meta-attribution/route.ts')
  assert.ok(cron.indexOf('senderSwitchOn()') < cron.indexOf('listEnabledTenants()'), 'switch checked before any DB work')
  assert.match(read('src/lib/meta-attribution/sender.ts'), /if \(!senderSwitchOn\(\)\) return \{ \.\.\.result, disabled: 'sender_switch_off' \}/)
  const worker = read('src/cf-container-worker.ts')
  assert.match(worker, /"META_SALES_CAPI_SENDER",/)
  assert.match(worker, /"\*\/5 \* \* \* \*": \["\/api\/cron\/bot-inbox", "\/api\/cron\/meta-attribution"\]/)
  const api = read('src/app/api/config/meta-attribution/route.ts')
  assert.match(api, /authenticateAPIWithPermission\(request, 'update_config'\)/)
  const sql = read('supabase/migrations/041_meta_capi_outbox.sql')
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE)\b/i)
  assert.doesNotMatch(sql, /REFERENCES public\."(Order|ChatMessage|ChatConversation)"/)
  for (const t of ['MetaCapiDataset', 'MetaConversionEvent']) assert.match(sql, new RegExp(`ALTER TABLE public\\."${t}" ENABLE ROW LEVEL SECURITY`))
})
