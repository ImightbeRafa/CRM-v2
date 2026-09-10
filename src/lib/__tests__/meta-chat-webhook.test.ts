import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import {
  describeMetaSignatureHeader,
  verifyMetaWebhookSignature,
} from '../meta-api'
import {
  looksLikeInstagramBusinessId,
  parseMetaChatPayload,
} from '../meta-chat'
import {
  encodeInstagramRefreshToken,
  getPageIdFromMetaChatMetadata,
  matchAccountByEncodedPageId,
} from '../social-account-meta'

const IG_BUSINESS_ID = '17841477784563392'
const PAGE_ID = '123456789012345'
const SENDER_ID = '987654321098765'

test('looksLikeInstagramBusinessId recognizes Meta IG business ids', () => {
  assert.equal(looksLikeInstagramBusinessId(IG_BUSINESS_ID), true)
  assert.equal(looksLikeInstagramBusinessId(PAGE_ID), false)
  assert.equal(looksLikeInstagramBusinessId(''), false)
})

test('parseMetaChatPayload still parses object:instagram messaging', () => {
  const parsed = parseMetaChatPayload({
    object: 'instagram',
    entry: [
      {
        id: IG_BUSINESS_ID,
        messaging: [
          {
            sender: { id: SENDER_ID },
            recipient: { id: IG_BUSINESS_ID },
            timestamp: 1_700_000_000_000,
            message: { mid: 'mid.ig.1', text: 'hola desde ig' },
          },
        ],
      },
    ],
  })

  assert.equal(parsed.messages.length, 1)
  assert.equal(parsed.messages[0]?.platform, 'instagram')
  assert.equal(parsed.messages[0]?.accountId, IG_BUSINESS_ID)
  assert.equal(parsed.messages[0]?.content, 'hola desde ig')
  assert.equal(parsed.messages[0]?.metadata.webhookObject, undefined)
  assert.equal(parsed.messages[0]?.metadata.pageId, undefined)
  assert.equal(parsed.messages[0]?.metadata.instagramAccountId, IG_BUSINESS_ID)
})

test('parseMetaChatPayload accepts object:page messaging and prefers IG recipient id', () => {
  const parsed = parseMetaChatPayload({
    object: 'page',
    entry: [
      {
        id: PAGE_ID,
        messaging: [
          {
            sender: { id: SENDER_ID },
            recipient: { id: IG_BUSINESS_ID },
            timestamp: 1_700_000_000_000,
            message: { mid: 'mid.page.1', text: 'hola desde page' },
          },
        ],
      },
    ],
  })

  assert.equal(parsed.messages.length, 1)
  const message = parsed.messages[0]!
  assert.equal(message.platform, 'instagram')
  assert.equal(message.accountId, IG_BUSINESS_ID)
  assert.equal(message.content, 'hola desde page')
  assert.equal(message.metadata.webhookObject, 'page')
  assert.equal(message.metadata.pageId, PAGE_ID)
  assert.equal(message.metadata.instagramAccountId, IG_BUSINESS_ID)
  assert.equal(message.metadata.recipientId, IG_BUSINESS_ID)
})

test('parseMetaChatPayload page object falls back to entry.id when recipient is not IG-shaped', () => {
  const parsed = parseMetaChatPayload({
    object: 'page',
    entry: [
      {
        id: PAGE_ID,
        messaging: [
          {
            sender: { id: SENDER_ID },
            recipient: { id: PAGE_ID },
            timestamp: 1_700_000_000_000,
            message: { mid: 'mid.page.2', text: 'page recipient' },
          },
        ],
      },
    ],
  })

  assert.equal(parsed.messages.length, 1)
  assert.equal(parsed.messages[0]?.accountId, PAGE_ID)
  assert.equal(parsed.messages[0]?.metadata.webhookObject, 'page')
  assert.equal(parsed.messages[0]?.metadata.pageId, PAGE_ID)
  assert.equal(parsed.messages[0]?.metadata.instagramAccountId, undefined)
})

test('parseMetaChatPayload ignores page payloads without messaging', () => {
  const parsed = parseMetaChatPayload({
    object: 'page',
    entry: [{ id: PAGE_ID, changes: [{ field: 'feed', value: {} }] }],
  })
  assert.equal(parsed.messages.length, 0)
  assert.deepEqual(parsed.ignoredReasons, ['page_without_messaging'])
})

test('matchAccountByEncodedPageId resolves SocialAccount via page: refreshToken', () => {
  const accounts = [
    { id: 'a1', refreshToken: encodeInstagramRefreshToken('999') },
    { id: 'a2', refreshToken: encodeInstagramRefreshToken(PAGE_ID) },
    { id: 'a3', refreshToken: 'waba:111' },
  ]
  assert.equal(matchAccountByEncodedPageId(accounts, PAGE_ID)?.id, 'a2')
  assert.equal(matchAccountByEncodedPageId(accounts, 'missing'), undefined)
  assert.equal(getPageIdFromMetaChatMetadata({ pageId: PAGE_ID, webhookObject: 'page' }), PAGE_ID)
  assert.equal(getPageIdFromMetaChatMetadata({ webhookObject: 'page' }), null)
})

test('describeMetaSignatureHeader never leaks full signature values', () => {
  assert.deepEqual(describeMetaSignatureHeader(null), {
    signaturePresent: false,
    signaturePrefix: 'missing',
  })
  assert.deepEqual(describeMetaSignatureHeader('sha256=abcdef0123456789deadbeef'), {
    signaturePresent: true,
    signaturePrefix: 'sha256=',
  })
  assert.deepEqual(describeMetaSignatureHeader('sha1=deadbeef'), {
    signaturePresent: true,
    signaturePrefix: 'sha1=',
  })
  assert.deepEqual(describeMetaSignatureHeader('md5=deadbeef'), {
    signaturePresent: true,
    signaturePrefix: 'other',
  })
  assert.deepEqual(describeMetaSignatureHeader('notaschemevalue'), {
    signaturePresent: true,
    signaturePrefix: 'notasche',
  })

  const serialized = JSON.stringify(describeMetaSignatureHeader('sha256=abcdef0123456789deadbeef'))
  assert.equal(serialized.includes('abcdef0123456789deadbeef'), false)
})

function signBody(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
}

function withWebhookSecrets(
  values: { meta?: string | null; instagram?: string | null },
  run: () => void
) {
  const previousMeta = process.env.META_APP_SECRET
  const previousInstagram = process.env.INSTAGRAM_APP_SECRET

  if (values.meta === null) delete process.env.META_APP_SECRET
  else if (values.meta !== undefined) process.env.META_APP_SECRET = values.meta

  if (values.instagram === null) delete process.env.INSTAGRAM_APP_SECRET
  else if (values.instagram !== undefined) process.env.INSTAGRAM_APP_SECRET = values.instagram

  try {
    run()
  } finally {
    if (previousMeta === undefined) delete process.env.META_APP_SECRET
    else process.env.META_APP_SECRET = previousMeta
    if (previousInstagram === undefined) delete process.env.INSTAGRAM_APP_SECRET
    else process.env.INSTAGRAM_APP_SECRET = previousInstagram
  }
}

test('verifyMetaWebhookSignature accepts META_APP_SECRET match', () => {
  const body = '{"object":"instagram","entry":[]}'
  withWebhookSecrets({ meta: 'meta-secret-value', instagram: 'ig-secret-value' }, () => {
    const result = verifyMetaWebhookSignature(body, signBody('meta-secret-value', body))
    assert.equal(result.valid, true)
    assert.equal(result.matchedSecret, 'meta')
    assert.equal(result.triedMeta, true)
    assert.equal(result.triedInstagram, true)
  })
})

test('verifyMetaWebhookSignature accepts INSTAGRAM_APP_SECRET-only match', () => {
  const body = '{"object":"page","entry":[{"id":"1"}]}'
  withWebhookSecrets({ meta: 'meta-secret-value', instagram: 'ig-secret-value' }, () => {
    const result = verifyMetaWebhookSignature(body, signBody('ig-secret-value', body))
    assert.equal(result.valid, true)
    assert.equal(result.matchedSecret, 'instagram')
    assert.equal(result.triedMeta, true)
    assert.equal(result.triedInstagram, true)
  })
})

test('verifyMetaWebhookSignature rejects when neither secret matches', () => {
  const body = '{"object":"instagram"}'
  withWebhookSecrets({ meta: 'meta-secret-value', instagram: 'ig-secret-value' }, () => {
    const result = verifyMetaWebhookSignature(body, signBody('wrong-secret', body))
    assert.equal(result.valid, false)
    assert.equal(result.matchedSecret, null)
    assert.equal(result.triedMeta, true)
    assert.equal(result.triedInstagram, true)
  })
})

test('verifyMetaWebhookSignature fails closed when secrets are missing', () => {
  const body = '{"object":"instagram"}'
  withWebhookSecrets({ meta: null, instagram: null }, () => {
    const result = verifyMetaWebhookSignature(body, signBody('any-secret', body))
    assert.equal(result.valid, false)
    assert.equal(result.matchedSecret, null)
    assert.equal(result.triedMeta, false)
    assert.equal(result.triedInstagram, false)
  })
})

test('verifyMetaWebhookSignature skips duplicate INSTAGRAM_APP_SECRET', () => {
  const body = '{"object":"instagram"}'
  withWebhookSecrets({ meta: 'same-secret', instagram: 'same-secret' }, () => {
    const result = verifyMetaWebhookSignature(body, signBody('same-secret', body))
    assert.equal(result.valid, true)
    assert.equal(result.matchedSecret, 'meta')
    assert.equal(result.triedMeta, true)
    assert.equal(result.triedInstagram, false)
  })
})

test('verifyMetaWebhookSignature rejects unsigned or non-sha256 headers', () => {
  const body = '{"object":"instagram"}'
  withWebhookSecrets({ meta: 'meta-secret-value', instagram: 'ig-secret-value' }, () => {
    assert.equal(verifyMetaWebhookSignature(body, null).valid, false)
    assert.equal(verifyMetaWebhookSignature(body, '').valid, false)
    assert.equal(verifyMetaWebhookSignature(body, 'sha1=deadbeef').valid, false)
  })
})
