import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildEventsBody, buildInstagramPurchaseEvent, purchaseEventId } from '../meta-attribution/capi-payload'
import { META_SALES_NOTICE_VERSION, instagramEventsAllowed, parseSettings } from '../meta-attribution/settings'
import { INSTAGRAM_REQUIRED_SCOPE, checkLineDataset, datasetOwnerId, requiredScopeFor } from '../meta-attribution/dataset'
import { INSTAGRAM_OAUTH_SCOPES, WHATSAPP_OAUTH_SCOPES } from '../meta-chat-config'
import { lineStatusLabel } from '../../app/config/social/components/MetaSalesAttributionCard'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

const ENV = { META_WA_APP_ID: '123456789012345', META_WA_APP_SECRET: 'a'.repeat(32) }
function graph(routes: Record<string, unknown>) {
  const calls: string[] = []
  const urls: string[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(String(url))
    calls.push(`${init.method} ${u.pathname}`)
    urls.push(String(url))
    const key = `${init.method} ${u.pathname.replace(/^\/v\d+\.\d+/, '')}`
    const body = routes[key] ?? { error: { code: 100 } }
    return new Response(JSON.stringify(body), { status: 'error' in (body as object) ? 400 : 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls, urls }
}

const igLine = { id: 'sa_ig', tenantId: 't1', platform: 'instagram', accountId: '17841400000000001', wabaId: null, accessToken: 'page-token' }

test('Instagram payload (Meta doc): business_messaging + instagram channel, IG account id + IGSID, nothing else', () => {
  const ev = buildInstagramPurchaseEvent({
    eventId: purchaseEventId('ord9'),
    eventTime: new Date('2026-10-22T15:00:00Z'),
    igAccountId: '17841400000000001',
    igsid: '6543210987654321',
    value: 18000,
    currency: 'CRC',
  })
  assert.deepEqual(ev, {
    event_name: 'Purchase',
    event_time: Date.parse('2026-10-22T15:00:00Z') / 1000,
    event_id: 'betsy:order:ord9:Purchase',
    action_source: 'business_messaging',
    messaging_channel: 'instagram',
    user_data: { instagram_business_account_id: '17841400000000001', ig_sid: '6543210987654321' },
    custom_data: { currency: 'CRC', value: 18000 },
  })
  const body = buildEventsBody([ev], null)
  assert.equal(body.partner_agent, 'betsycrm')
  const json = JSON.stringify(body)
  for (const forbidden of ['ctwa_clid', '"em"', '"ph"', '"fn"', '"ln"', 'external_id', 'page_id']) assert.ok(!json.includes(forbidden), forbidden)
  assert.throws(() => buildInstagramPurchaseEvent({ eventId: 'x', eventTime: new Date(), igAccountId: '1784', igsid: '6543210987654321', value: 1, currency: 'USD' }), /BAD_INSTAGRAM_ID/)
  assert.throws(() => buildInstagramPurchaseEvent({ eventId: 'x', eventTime: new Date(), igAccountId: '17841400000000001', igsid: 'abc', value: 1, currency: 'USD' }), /BAD_INSTAGRAM_ID/)
})

test('Instagram line check: instagram_manage_events on the Page token, dataset on the IG account id', async () => {
  assert.equal(requiredScopeFor('instagram'), 'instagram_manage_events')
  assert.equal(requiredScopeFor('whatsapp'), 'whatsapp_business_manage_events')
  assert.equal(datasetOwnerId(igLine), '17841400000000001')
  assert.equal(datasetOwnerId({ platform: 'whatsapp', wabaId: '1111111111', accountId: '999999' }), '1111111111')

  const waScopeOnly = graph({ 'GET /debug_token': { data: { is_valid: true, scopes: ['whatsapp_business_manage_events'], user_id: '10001' } } })
  const missing = await checkLineDataset(igLine, { fetchImpl: waScopeOnly.fetchImpl, env: ENV })
  assert.equal(missing.status, 'missing_permission', 'the WhatsApp permission does not count for Instagram')
  assert.equal(missing.grantedByUserId, '10001', 'who granted the token is learned for the deletion callback')
  assert.deepEqual(waScopeOnly.calls, ['GET /v24.0/debug_token'])

  const scopes = { data: { is_valid: true, scopes: ['instagram_manage_messages', INSTAGRAM_REQUIRED_SCOPE] } }
  const created = graph({
    'GET /debug_token': scopes,
    'GET /17841400000000001/dataset': { data: [] },
    'POST /17841400000000001/dataset': { id: '444555666' },
  })
  const ready = await checkLineDataset(igLine, { fetchImpl: created.fetchImpl, env: ENV })
  assert.deepEqual([ready.status, ready.datasetId], ['ready', '444555666'])
  assert.ok(created.calls.includes('POST /v24.0/17841400000000001/dataset'))
  assert.ok(created.urls.every((u) => u.startsWith('https://graph.facebook.com/')), 'graph.facebook.com, per the doc')
  assert.ok(created.urls.filter((u) => !u.includes('/debug_token')).every((u) => !u.includes('page-token')), 'dataset calls: token only as a Bearer header')

  // Before the owner accepts the Instagram notice, the check only looks.
  const look = graph({ 'GET /debug_token': scopes, 'GET /17841400000000001/dataset': { data: [] } })
  const r = await checkLineDataset(igLine, { fetchImpl: look.fetchImpl, env: ENV, createIfMissing: false })
  assert.equal(r.errorCode, 'no_dataset_yet')
  assert.ok(!look.calls.some((c) => c.startsWith('POST')))
  assert.equal((await checkLineDataset({ ...igLine, accountId: null }, { fetchImpl: look.fetchImpl, env: ENV })).errorCode, 'line_not_ready')
})

test('Instagram needs the new notice; WhatsApp keeps working on the first one', () => {
  const at = '2026-10-01T00:00:00.000Z'
  const old = parseSettings({ enabled: true, config: { acknowledgedAt: at } })
  assert.equal(old.enabled, true)
  assert.equal(instagramEventsAllowed(old), false)
  const current = parseSettings({ enabled: true, config: { acknowledgedAt: at, noticeVersion: META_SALES_NOTICE_VERSION } })
  assert.equal(instagramEventsAllowed(current), true)
  assert.equal(instagramEventsAllowed(parseSettings({ enabled: false, config: { acknowledgedAt: at, noticeVersion: META_SALES_NOTICE_VERSION } })), false)
  assert.equal(parseSettings({ enabled: true, config: { noticeVersion: META_SALES_NOTICE_VERSION } }).noticeVersion, null, 'no version without an acknowledgement')
  const settings = read('src/lib/meta-attribution/settings.ts')
  assert.match(settings, /const noticeVersion = input\.enabled \? \(input\.acknowledge \? META_SALES_NOTICE_VERSION : current\.noticeVersion\) : null/)
})

test('settings card: IG lines show ready / missing permission / reconnect needed / notice pending', () => {
  assert.equal(lineStatusLabel({ platform: 'instagram', status: 'ready' }, true).label, 'Listo')
  assert.equal(lineStatusLabel({ platform: 'instagram', status: 'missing_permission' }, true).label, 'Falta permiso: reconectá Instagram')
  assert.equal(lineStatusLabel({ platform: 'instagram', status: 'token_invalid' }, false).label, 'Reconectar Instagram')
  assert.equal(lineStatusLabel({ platform: 'instagram', status: 'ready' }, false).label, 'Falta aceptar el aviso de Instagram')
  assert.equal(lineStatusLabel({ platform: 'whatsapp', status: 'missing_permission' }, false).label, 'Falta permiso: reconectá WhatsApp')
  const card = read('src/app/config/social/components/MetaSalesAttributionCard.tsx')
  assert.match(card, /el identificador de Instagram del cliente en ese chat \(sin nombres, teléfonos ni mensajes\)/)
  const api = read('src/app/api/config/meta-attribution/route.ts')
  assert.match(api, /platform: \{ in: \['whatsapp', 'instagram'\] \}/)
  assert.match(api, /instagramNoticeAccepted: instagramEventsAllowed\(settings\)/)
})

test('sweep / sender: IG accepted only from an ad referral before the order, same paid + 7-day rules, same outbox', () => {
  const sweep = read('src/lib/meta-attribution/sweep.ts')
  assert.doesNotMatch(sweep, /skip\('not_whatsapp'\)/)
  assert.match(sweep, /\(s\."platform" = 'instagram' AND r\."platform" = 'instagram' AND r\."sourceType" = 'ad' AND r\."sourceId" IS NOT NULL\)/)
  assert.match(sweep, /if \(channel === 'instagram' && !igAllowed\) \{/)
  assert.match(sweep, /if \(channel === 'instagram' && !NUMERIC_ID\.test\(String\(o\.peerId \|\| ''\)\)\) \{/)
  assert.match(sweep, /\$\{currency\}, \$\{channel\}, 'pending', \$\{now\}/)
  assert.ok(sweep.indexOf('if (!isPaymentConfirmed(o))') > sweep.indexOf("channel === 'instagram' && !igAllowed"))
  const sender = read('src/lib/meta-attribution/sender.ts')
  assert.match(sender, /if \(isInstagram && !instagramEventsAllowed\(settings\)\) \{/)
  assert.match(sender, /where: \{ id: referral\.conversationId, tenantId, socialAccountId \}/, 'IGSID re-read inside the business and line')
  assert.match(sender, /buildInstagramPurchaseEvent\(\{ eventId: row\.eventId, eventTime: row\.eventTime, igAccountId: ownerId, igsid/)
  const dataset = read('src/lib/meta-attribution/dataset.ts')
  assert.match(dataset, /platform: \{ in: \['whatsapp', 'instagram'\] \}/)
  assert.match(dataset, /account\.platform === 'instagram' \? opts\.createIfMissing !== false && igAllowed : opts\.createIfMissing/)
})

test('reconnect asks for the events permissions; earlier connections keep working', () => {
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('instagram_manage_events'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('instagram_manage_messages'), 'messaging scopes unchanged')
  assert.ok((WHATSAPP_OAUTH_SCOPES as readonly string[]).includes('whatsapp_business_manage_events'))
  const authUrl = read('src/app/api/auth/instagram/auth-url/route.ts')
  assert.match(authUrl, /params\.set\('scope', INSTAGRAM_OAUTH_SCOPES\.join\(','\)\)/)
  assert.match(authUrl, /params\.set\('auth_type', 'rerequest'\)/)
})
