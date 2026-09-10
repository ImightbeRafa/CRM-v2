import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWebhookSocialAccount } from '../chat-webhook-account'
import { encodeInstagramRefreshToken } from '../social-account-meta'
import type { ParsedMetaChatMessage } from '../meta-chat'

function waEvent(accountId: string): ParsedMetaChatMessage {
  return {
    platform: 'whatsapp',
    accountId,
    senderId: '50688887777',
    senderName: 'Ana',
    content: 'hola',
    messageType: 'text',
    providerMessageId: 'wamid.1',
    sentAt: new Date('2026-09-10T12:00:00.000Z'),
    metadata: {},
  }
}

function igEvent(accountId: string, pageId?: string): ParsedMetaChatMessage {
  return {
    platform: 'instagram',
    accountId,
    senderId: 'ig-user-1',
    senderName: 'Ig',
    content: 'hola ig',
    messageType: 'text',
    providerMessageId: 'mid.1',
    sentAt: new Date('2026-09-10T12:00:00.000Z'),
    metadata: pageId ? { webhookObject: 'page', pageId } : {},
  }
}

test('resolveWebhookSocialAccount binds unique active SocialAccount', async () => {
  const calls: unknown[] = []
  const db = {
    socialAccount: {
      findMany: async (args: unknown) => {
        calls.push(args)
        return [{ id: 'sa-1', tenantId: 'tenant-a', refreshToken: 'waba:111' }]
      },
    },
  }

  const result = await resolveWebhookSocialAccount(db, waEvent('phone-1'))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.account.tenantId, 'tenant-a')
    assert.equal(result.account.id, 'sa-1')
  }
  assert.equal(calls.length, 1)
})

test('resolveWebhookSocialAccount refuses cross-tenant ambiguous match', async () => {
  const db = {
    socialAccount: {
      findMany: async () => [
        { id: 'sa-a', tenantId: 'tenant-a', refreshToken: 'waba:1' },
        { id: 'sa-b', tenantId: 'tenant-b', refreshToken: 'waba:1' },
      ],
    },
  }

  const result = await resolveWebhookSocialAccount(db, waEvent('shared-phone'))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'ambiguous_tenant_match')
  }
})

test('resolveWebhookSocialAccount IG page fallback is exact and refuses multi-tenant', async () => {
  const pageId = '123456789012345'
  const encoded = encodeInstagramRefreshToken(pageId)
  const findManyCalls: any[] = []

  const db = {
    socialAccount: {
      findMany: async (args: any) => {
        findManyCalls.push(args)
        if (args?.where?.accountId) return []
        return [
          { id: 'ig-a', tenantId: 't1', refreshToken: encoded },
          { id: 'ig-b', tenantId: 't2', refreshToken: encoded },
        ]
      },
    },
  }

  const ambiguous = await resolveWebhookSocialAccount(db, igEvent('17841477784563392', pageId))
  assert.equal(ambiguous.ok, false)
  if (!ambiguous.ok) assert.equal(ambiguous.reason, 'ambiguous_tenant_match')

  // Second call: unique page match
  const dbUnique = {
    socialAccount: {
      findMany: async (args: any) => {
        if (args?.where?.accountId) return []
        assert.equal(args?.where?.refreshToken, encoded)
        assert.equal(args?.where?.platform, 'instagram')
        return [{ id: 'ig-only', tenantId: 't1', refreshToken: encoded }]
      },
    },
  }
  const unique = await resolveWebhookSocialAccount(dbUnique, igEvent('17841477784563392', pageId))
  assert.equal(unique.ok, true)
  if (unique.ok) assert.equal(unique.account.id, 'ig-only')
})

test('resolveWebhookSocialAccount returns account_not_found when none match', async () => {
  const db = {
    socialAccount: {
      findMany: async () => [],
    },
  }
  const result = await resolveWebhookSocialAccount(db, waEvent('missing'))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'account_not_found')
})
