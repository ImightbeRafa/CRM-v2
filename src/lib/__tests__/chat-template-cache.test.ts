import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  CHAT_TEMPLATE_CACHE_TTL_MS,
  clearChatTemplateCacheMemoryForTests,
  expireChatTemplateCacheMemoryForTests,
  getApprovedTemplates,
  chatTemplateCacheKey,
} from '../chat-template-cache'
import type { WhatsAppTemplateStatusRow } from '../wa-template-approval'

const sample = (name: string): WhatsAppTemplateStatusRow => ({
  name,
  language: 'es',
  status: 'APPROVED',
  category: 'UTILITY',
})

describe('chat-template-cache', () => {
  afterEach(() => {
    clearChatTemplateCacheMemoryForTests()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('two opens within TTL → 1 upstream fetch', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls += 1
      return [sample('hello_world')]
    }
    const a = await getApprovedTemplates('waba-1', fetchFn)
    const b = await getApprovedTemplates('waba-1', fetchFn)
    assert.equal(calls, 1)
    assert.equal(a[0]?.name, 'hello_world')
    assert.equal(b[0]?.name, 'hello_world')
  })

  it('TTL expiry → second upstream call', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls += 1
      return [sample(`v${calls}`)]
    }
    await getApprovedTemplates('waba-ttl', fetchFn)
    expireChatTemplateCacheMemoryForTests('waba-ttl')
    const second = await getApprovedTemplates('waba-ttl', fetchFn)
    assert.equal(calls, 2)
    assert.equal(second[0]?.name, 'v2')
    assert.ok(CHAT_TEMPLATE_CACHE_TTL_MS >= 300_000)
  })

  it('different WABAs use separate keys / separate fetches', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls += 1
      return [sample(`t${calls}`)]
    }
    await getApprovedTemplates('waba-a', fetchFn)
    await getApprovedTemplates('waba-b', fetchFn)
    await getApprovedTemplates('waba-a', fetchFn)
    assert.equal(calls, 2)
    assert.equal(chatTemplateCacheKey('waba-a'), 'chat:wa-templates:v1:waba-a')
    assert.notEqual(chatTemplateCacheKey('waba-a'), chatTemplateCacheKey('waba-b'))
  })
})
