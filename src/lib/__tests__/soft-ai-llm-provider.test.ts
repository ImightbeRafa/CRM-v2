import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LUNA_CHAT_AGENT_MODEL,
  OPENAI_PRICING_VERSION,
  XAI_PRICING_VERSION,
  pricingVersionFor,
  softAiProviderFor,
} from '@/lib/soft-ai/agent-types'
import {
  buildSoftAiResponsesBody,
  createSoftAiClient,
  isSoftAiProviderConfigured,
} from '@/lib/soft-ai/llm/client'
import { estimateCostMicros } from '@/lib/soft-ai/llm/usage'

const base = {
  instructions: 'sys',
  input: [{ type: 'message', role: 'user', content: 'hola' }],
  promptCacheKey: 't:a:1:s:m',
}

const saved = {
  openai: process.env.OPENAI_API_KEY,
  xai: process.env.XAI_API_KEY,
  effort: process.env.SOFT_AI_OPENAI_REASONING,
}
afterEach(() => {
  for (const [key, value] of [
    ['OPENAI_API_KEY', saved.openai],
    ['XAI_API_KEY', saved.xai],
    ['SOFT_AI_OPENAI_REASONING', saved.effort],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('soft-ai provider routing', () => {
  it('routes gpt-* to OpenAI and grok-* to xAI', () => {
    assert.equal(softAiProviderFor(LUNA_CHAT_AGENT_MODEL), 'openai')
    assert.equal(softAiProviderFor('grok-4.7'), 'xai')
    assert.equal(pricingVersionFor(LUNA_CHAT_AGENT_MODEL), OPENAI_PRICING_VERSION)
    assert.equal(pricingVersionFor('grok-4.7'), XAI_PRICING_VERSION)
    assert.equal(pricingVersionFor(null), XAI_PRICING_VERSION)
  })

  it('reports provider configuration per model without revealing keys', () => {
    delete process.env.OPENAI_API_KEY
    process.env.XAI_API_KEY = 'x'
    assert.equal(isSoftAiProviderConfigured('gpt-6-luna'), false)
    assert.equal(isSoftAiProviderConfigured('grok-4.7'), true)
    process.env.OPENAI_API_KEY = '  '
    assert.equal(isSoftAiProviderConfigured('gpt-6-luna'), false)
    process.env.OPENAI_API_KEY = 'k'
    assert.equal(isSoftAiProviderConfigured('gpt-6-luna'), true)
  })

  it('missing OpenAI key fails closed with LLM_NOT_CONFIGURED', () => {
    delete process.env.OPENAI_API_KEY
    assert.throws(() => createSoftAiClient('gpt-6-luna'), /LLM_NOT_CONFIGURED/)
    delete process.env.XAI_API_KEY
    assert.throws(() => createSoftAiClient('grok-4.7'), /XAI_NOT_CONFIGURED/)
  })
})

describe('soft-ai request body', () => {
  it('OpenAI reasoning low: no temperature, encrypted reasoning, roomier output cap', () => {
    delete process.env.SOFT_AI_OPENAI_REASONING
    const body = buildSoftAiResponsesBody({
      ...base,
      model: 'gpt-6-luna',
      temperature: 0.1,
      reasoningEffort: 'low',
      maxOutputTokens: 700,
    })
    assert.equal(body.model, 'gpt-6-luna')
    assert.equal(body.store, false)
    assert.deepEqual(body.reasoning, { effort: 'low' })
    assert.equal('temperature' in body, false)
    assert.deepEqual(body.include, ['reasoning.encrypted_content'])
    assert.equal(body.max_output_tokens, 1500)
    assert.equal(body.prompt_cache_key, 't:a:1:s:m')
  })

  it('OpenAI reasoning none keeps temperature and the plain cap', () => {
    process.env.SOFT_AI_OPENAI_REASONING = 'none'
    const body = buildSoftAiResponsesBody({ ...base, model: 'gpt-6-luna', temperature: 0.1 })
    assert.deepEqual(body.reasoning, { effort: 'none' })
    assert.equal(body.temperature, 0.1)
    assert.equal(body.max_output_tokens, 700)
    assert.equal('include' in body, false)
  })

  it('xAI body is unchanged (temperature, low reasoning, 700 cap)', () => {
    const body = buildSoftAiResponsesBody({ ...base, model: 'grok-4.7' })
    assert.equal(body.temperature, 0.1)
    assert.deepEqual(body.reasoning, { effort: 'low' })
    assert.equal(body.max_output_tokens, 700)
    assert.equal('include' in body, false)
  })

  it('rejects models off the allowlist before any request', () => {
    assert.throws(
      () => buildSoftAiResponsesBody({ ...base, model: 'gpt-4o' }),
      /SOFT_AI_MODEL_NOT_ALLOWED/,
    )
  })
})

describe('soft-ai pricing', () => {
  it('prices Luna at 0.10 / 0.50 per 1M with the cached discount', () => {
    const cost = estimateCostMicros({
      model: 'gpt-6-luna',
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    })
    assert.equal(cost, 600_000)
    const cached = estimateCostMicros({
      model: 'gpt-6-luna',
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    })
    assert.equal(cached, 10_000)
  })

  it('keeps Grok cached input at the full input rate', () => {
    const cost = estimateCostMicros({
      model: 'grok-4.7',
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 0,
    })
    assert.equal(cost, 2_000_000)
  })

  it('never counts more cached tokens than input tokens', () => {
    const cost = estimateCostMicros({
      model: 'gpt-6-luna',
      inputTokens: 100,
      cachedInputTokens: 500,
      outputTokens: 0,
    })
    assert.equal(cost, estimateCostMicros({ model: 'gpt-6-luna', inputTokens: 100, cachedInputTokens: 100, outputTokens: 0 }))
  })
})
