import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INSTAGRAM_OAUTH_SCOPES,
  getDefaultMetaChatProductionOrigin,
  getInstagramLoginConfigId,
  getMetaChatOrigin,
  getMetaChatPublicUrls,
  getMetaChatReadiness,
} from '../meta-chat-config'
import {
  buildNoPagesHtml,
  logInstagramPageDiscovery,
} from '../instagram-connect'
import {
  encodeInstagramRefreshToken,
  encodeWhatsAppRefreshToken,
  parseSocialRefreshToken,
} from '../social-account-meta'

test('Instagram OAuth scopes include Page listing required by the callback', () => {
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('instagram_manage_messages'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('pages_show_list'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('pages_manage_metadata'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('pages_messaging'))
})

test('canonical Meta production origin prefers www host', () => {
  const origin = getDefaultMetaChatProductionOrigin()
  assert.ok(origin.startsWith('https://www.'))
  assert.ok(origin.endsWith(['betsycrm', 'com'].join('.')))
  const urls = getMetaChatPublicUrls()
  assert.equal(urls.inboxWebhook, `${origin}/api/chat/webhook`)
  assert.equal(urls.instagramOAuthRedirect, `${origin}/api/auth/instagram/callback`)
})

test('getMetaChatOrigin prefers NEXTAUTH_URL over apex fallback', () => {
  const previous = process.env.NEXTAUTH_URL
  const preferred = getDefaultMetaChatProductionOrigin()
  process.env.NEXTAUTH_URL = preferred
  assert.equal(getMetaChatOrigin(), preferred)
  const readiness = getMetaChatReadiness()
  assert.equal(readiness.urls.origin, preferred)
  assert.equal(readiness.urls.inboxWebhook, `${preferred}/api/chat/webhook`)
  if (previous === undefined) delete process.env.NEXTAUTH_URL
  else process.env.NEXTAUTH_URL = previous
})

test('public Meta URLs point at the CRM inbox webhook, not the staff bot', () => {
  const urls = getMetaChatPublicUrls('https://crm.example')
  assert.equal(urls.inboxWebhook, 'https://crm.example/api/chat/webhook')
  assert.equal(urls.instagramOAuthRedirect, 'https://crm.example/api/auth/instagram/callback')
  assert.equal(urls.staffBotWebhook, 'https://crm.example/api/bot/whatsapp/webhook')
  assert.notEqual(urls.inboxWebhook, urls.staffBotWebhook)
})

test('readiness reports missing inbox env without leaking values', () => {
  const previous = process.env.META_APP_SECRET
  delete process.env.META_APP_SECRET
  const readiness = getMetaChatReadiness()
  assert.ok(readiness.blockers.includes('META_APP_SECRET'))
  assert.equal(readiness.product, 'betsy-chat-crm-inbox')
  const secretFlag = readiness.env.inboxRequired.find((item) => item.key === 'META_APP_SECRET')
  assert.equal(secretFlag?.set, false)
  const serialized = JSON.stringify(readiness)
  assert.equal(serialized.includes('META_APP_SECRET":"'), false)
  if (previous === undefined) delete process.env.META_APP_SECRET
  else process.env.META_APP_SECRET = previous
})

test('readiness notes warn about www origin and verify-token fallback', () => {
  const readiness = getMetaChatReadiness()
  assert.ok(readiness.notes.some((note) => note.includes('NEXTAUTH_URL origin')))
  assert.ok(readiness.notes.some((note) => note.includes('META_WEBHOOK_VERIFY_TOKEN')))
  assert.ok(readiness.warnings.includes('NEXT_PUBLIC_IG_LOGIN_CONFIG_ID') || readiness.env.inboxRecommended.some((item) => item.key === 'NEXT_PUBLIC_IG_LOGIN_CONFIG_ID'))
})

test('empty-pages Spanish HTML includes actionable admin / Empresa / Dev mode steps', () => {
  const html = buildNoPagesHtml({
    facebookUserName: 'Rafa Test',
    facebookUserId: '12345',
    pageCount: 0,
    pageSource: 'none',
  })
  assert.match(html, /No se encontraron páginas de Facebook/)
  assert.match(html, /Rafa Test/)
  assert.match(html, /administrador/)
  assert.match(html, /Empresa/)
  assert.match(html, /Development/)
  assert.match(html, /Tester/)
  assert.match(html, /Páginas detectadas:\s*<strong>0<\/strong>/)
  assert.doesNotMatch(html, /EAA[A-Za-z0-9]/)
  assert.doesNotMatch(html, /access_token/)
})

test('social refreshToken encodes WABA and Page ids without access tokens', () => {
  assert.equal(encodeWhatsAppRefreshToken('998877'), 'waba:998877')
  assert.equal(encodeInstagramRefreshToken('112233'), 'page:112233')
  assert.deepEqual(parseSocialRefreshToken('waba:998877'), {
    whatsappBusinessAccountId: '998877',
    pageId: null,
  })
  assert.deepEqual(parseSocialRefreshToken('page:112233'), {
    whatsappBusinessAccountId: null,
    pageId: '112233',
  })
  assert.deepEqual(parseSocialRefreshToken('445566'), {
    whatsappBusinessAccountId: '445566',
    pageId: null,
  })
})

test('getInstagramLoginConfigId reads dedicated env only (not WA config)', () => {
  const previousIg = process.env.NEXT_PUBLIC_IG_LOGIN_CONFIG_ID
  const previousWa = process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID
  process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID = 'wa-config-only'
  delete process.env.NEXT_PUBLIC_IG_LOGIN_CONFIG_ID
  delete process.env.META_IG_LOGIN_CONFIG_ID
  assert.equal(getInstagramLoginConfigId(), null)
  process.env.NEXT_PUBLIC_IG_LOGIN_CONFIG_ID = 'ig-business-config'
  assert.equal(getInstagramLoginConfigId(), 'ig-business-config')
  if (previousIg === undefined) delete process.env.NEXT_PUBLIC_IG_LOGIN_CONFIG_ID
  else process.env.NEXT_PUBLIC_IG_LOGIN_CONFIG_ID = previousIg
  if (previousWa === undefined) delete process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID
  else process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID = previousWa
})

test('page discovery logger accepts zero page count without throwing', () => {
  assert.doesNotThrow(() =>
    logInstagramPageDiscovery({
      pageCount: 0,
      pageSource: 'none',
      matchCount: 0,
      facebookUserId: 'user-1',
    }),
  )
})
