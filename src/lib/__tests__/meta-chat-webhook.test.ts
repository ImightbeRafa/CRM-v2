import assert from 'node:assert/strict'
import test from 'node:test'
import { describeMetaSignatureHeader } from '../meta-api'
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
