import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INSTAGRAM_OAUTH_SCOPES,
  getMetaChatPublicUrls,
  getMetaChatReadiness,
} from '../meta-chat-config'

test('Instagram OAuth scopes include Page listing required by the callback', () => {
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('instagram_manage_messages'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('pages_show_list'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('pages_manage_metadata'))
  assert.ok(INSTAGRAM_OAUTH_SCOPES.includes('pages_messaging'))
})

test('public Meta URLs point at the CRM inbox webhook, not the staff bot', () => {
  const urls = getMetaChatPublicUrls('https://betsycrm.com')
  assert.equal(urls.inboxWebhook, 'https://betsycrm.com/api/chat/webhook')
  assert.equal(urls.instagramOAuthRedirect, 'https://betsycrm.com/api/auth/instagram/callback')
  assert.equal(urls.staffBotWebhook, 'https://betsycrm.com/api/bot/whatsapp/webhook')
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
  if (previous === undefined) delete process.env.META_APP_SECRET
  else process.env.META_APP_SECRET = previous
})
