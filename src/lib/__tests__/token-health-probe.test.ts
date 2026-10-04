import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  isTransientGraphFailure,
  probeSocialAccountToken,
  redactMetaMessage,
} from '@/lib/social-account-token-health'

const realFetch = globalThis.fetch
const envBackup = { ...process.env }
afterEach(() => {
  globalThis.fetch = realFetch
  process.env = { ...envBackup }
})

function mockFetch(status: number, body: unknown) {
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return urls
}

const hmac = (secret: string, token: string) => crypto.createHmac('sha256', secret).update(token).digest('hex')
const wa = { id: 'acc1', platform: 'whatsapp', accountId: '123', accessToken: 'EAAtoken' }

test('WhatsApp probe signs appsecret_proof with the WhatsApp app secret (like real sends)', async () => {
  process.env.META_APP_SECRET = 'main-app-secret-aaaaaaaaaaaaaaaa'
  process.env.META_WA_APP_SECRET = 'wa-app-secret-bbbbbbbbbbbbbbbbbb'
  const urls = mockFetch(200, { id: '123' })
  const res = await probeSocialAccountToken(wa)
  assert.equal(res.tokenStatus, 'valid')
  assert.match(urls[0], new RegExp(`appsecret_proof=${hmac(process.env.META_WA_APP_SECRET, 'EAAtoken')}`))
})

test('Instagram probe signs with the Inbox app secret, not the Staff META_APP_SECRET', async () => {
  // IG tokens are issued by the Inbox app (META_APP_ID, secret META_WA_APP_SECRET);
  // on live META_APP_SECRET is the Staff bot app and its proof is rejected by Graph.
  process.env.META_APP_SECRET = 'main-app-secret-aaaaaaaaaaaaaaaa'
  process.env.META_WA_APP_SECRET = 'wa-app-secret-bbbbbbbbbbbbbbbbbb'
  const urls = mockFetch(200, { username: 'shop' })
  await probeSocialAccountToken({ ...wa, platform: 'instagram' })
  assert.match(urls[0], new RegExp(`appsecret_proof=${hmac(process.env.META_WA_APP_SECRET, 'EAAtoken')}`))
})

test('timeouts, Meta 5xx and rate limits are transient; a revoked token is not', async () => {
  globalThis.fetch = (async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  }) as typeof fetch
  const thrown = await probeSocialAccountToken(wa)
  assert.equal(thrown.transient, true)

  mockFetch(500, { error: { code: 2, message: 'Service temporarily unavailable' } })
  assert.equal((await probeSocialAccountToken(wa)).transient, true)

  mockFetch(400, { error: { code: 4, message: 'Application request limit reached' } })
  assert.equal((await probeSocialAccountToken(wa)).transient, true)

  mockFetch(401, { error: { code: 190, error_subcode: 460, message: 'Session invalidated' } })
  const revoked = await probeSocialAccountToken(wa)
  assert.equal(revoked.tokenStatus, 'revoked')
  assert.equal(revoked.transient, false)
  assert.equal(revoked.lastErrorCode, '190/460')

  assert.equal(isTransientGraphFailure(400, '100'), false)
})

test('Instagram probes the linked Page (same object sends use) when a page id is stored', async () => {
  const urls = mockFetch(200, { id: '555' })
  await probeSocialAccountToken({ ...wa, platform: 'instagram', accountId: '178', refreshToken: 'page:555' })
  assert.match(urls[0], /\/555\?fields=id/)
  const legacy = mockFetch(200, { username: 'shop' })
  await probeSocialAccountToken({ ...wa, platform: 'instagram', accountId: '178' })
  assert.match(legacy[0], /\/178\?fields=username/)
})

test('Meta rate-limit codes and is_transient are transient; tokens are masked in logged text', () => {
  for (const code of ['80001', '80002', '80008']) assert.equal(isTransientGraphFailure(400, code), true)
  assert.equal(isTransientGraphFailure(400, '100', true), true)
  const token = 'EAA' + 'x'.repeat(40)
  assert.doesNotMatch(redactMetaMessage(`Malformed access token ${token}`, token), /EAA/)
  assert.doesNotMatch(redactMetaMessage('Malformed access token EAB' + 'y'.repeat(30), token), /EAB/)
  assert.equal(redactMetaMessage('Invalid appsecret_proof provided in the API argument', token).includes('appsecret_proof'), true)
})

test('cron keeps the stored status on a transient failure', () => {
  const src = readFileSync('src/app/api/cron/chat-token-health/route.ts', 'utf8')
  assert.match(src, /\.\.\.\(probe\.transient \? \{\} : \{ tokenStatus: probe\.tokenStatus \}\)/)
})
