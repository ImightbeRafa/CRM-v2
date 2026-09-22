import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { composeEffectiveBehavior } from '../soft-ai/agent-resolver'
import { hasAiFullUnlock, parseChatAgentLayerConfig } from '../soft-ai/agent-config'
import { FIXTURE_SOCIAL_ACCOUNT_ID } from '../soft-ai/__fixtures__/forge-wa-v2'
import { FORGE_WA_V1_FIXTURE_SET_HASH } from '../soft-ai/__fixtures__/forge-wa-v1'
import { validateAgentOutput } from '../soft-ai/llm/output-validator'
import { selectHistoryWindow, buildAgentUserPrompt } from '../soft-ai/llm/prompt'
import { assertAllowedModel, buildSoftAiPromptCacheKey } from '../soft-ai/llm/model-policy'
import { resolveSoftAiModel } from '../soft-ai/llm/client'
import { estimateCostMicros } from '../soft-ai/llm/usage'
import {
  CHAT_AGENT_MODEL_ALLOWLIST,
  DEFAULT_CHAT_AGENT_MODEL,
  DEFAULT_PRICING_VERSION,
  FIXTURE_SET_HASH_V2,
  FORGE_WA_V2_FIXTURE_SET_HASH,
  isAllowedChatAgentModel,
} from '../soft-ai/agent-types'
import { FORGE_WA_V2_FIXTURE_SET_HASH as FIXTURE_HASH_REEXPORT } from '../soft-ai/__fixtures__/forge-wa-v2'
import {
  formatAgentHeaderLabel,
  agentStateDot,
  softAiOutboundLabel,
} from '../soft-ai/agent-inbox-projection'
import { hashSoftAiOutput } from '../soft-ai/agent-claim-gates'

describe('soft-ai agent resolver compose (1.9, 1.15, 1.22)', () => {
  it('conversation mode only restricts — never upgrades suggest to send', () => {
    const r = composeEffectiveBehavior({
      conversationAiMode: 'ai_active',
      operationMode: 'ai_suggest',
      unlockedForSend: true,
    })
    assert.equal(r.behavior, 'suggest')
  })

  it('ai_full without unlock degrades to suggest', () => {
    const r = composeEffectiveBehavior({
      conversationAiMode: 'ai_active',
      operationMode: 'ai_full',
      unlockedForSend: false,
    })
    assert.equal(r.behavior, 'suggest')
  })

  it('ai_full with unlock can send', () => {
    const r = composeEffectiveBehavior({
      conversationAiMode: 'ai_active',
      operationMode: 'ai_full',
      unlockedForSend: true,
    })
    assert.equal(r.behavior, 'send')
  })

  it('human/paused/missing are sticky skip until resume (1.22)', () => {
    for (const mode of ['human', 'paused', null] as const) {
      const r = composeEffectiveBehavior({
        conversationAiMode: mode,
        operationMode: 'ai_full',
        unlockedForSend: true,
      })
      assert.equal(r.behavior, 'skip')
    }
  })
})

describe('soft-ai aiFullUnlock (1.15)', () => {
  it('blocks send without unlock; unlock requires matching fixture hash', () => {
    const cfg = parseChatAgentLayerConfig({
      accountAllowlist: [FIXTURE_SOCIAL_ACCOUNT_ID],
      fixtureSetHash: FORGE_WA_V1_FIXTURE_SET_HASH,
      aiFullUnlock: {},
    })
    assert.equal(hasAiFullUnlock(cfg, FIXTURE_SOCIAL_ACCOUNT_ID), false)

    const unlocked = parseChatAgentLayerConfig({
      ...cfg,
      aiFullUnlock: {
        [FIXTURE_SOCIAL_ACCOUNT_ID]: {
          passedAt: '2026-09-21T00:00:00.000Z',
          approvedBy: 'cos',
          fixtureSetHash: FORGE_WA_V1_FIXTURE_SET_HASH,
          passRate: 0.95,
        },
      },
    })
    assert.equal(hasAiFullUnlock(unlocked, FIXTURE_SOCIAL_ACCOUNT_ID), true)

    const stale = parseChatAgentLayerConfig({
      ...unlocked,
      fixtureSetHash: 'other-hash',
    })
    assert.equal(hasAiFullUnlock(stale, FIXTURE_SOCIAL_ACCOUNT_ID), false)
  })
})

describe('soft-ai output validator + history (1.7, gate 9)', () => {
  it('rejects unsourced money and write claims', () => {
    const bad = validateAgentOutput({
      text: 'El kit cuesta ₡27000 y ya creé tu pedido',
      citedToolNames: [],
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.reasons.includes('unsourced_money'))
    assert.ok(bad.reasons.includes('write_claim'))
  })

  it('order status citation alone does not authorize money (A2)', () => {
    const bad = validateAgentOutput({
      text: 'Tu pedido sale ₡15000',
      citedToolNames: ['get_order_status'],
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.reasons.includes('unsourced_money'))
  })

  it('history window keeps only last N messages for one conversation', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      direction: (i % 2 === 0 ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      content: `msg-${i}`,
      sentAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    }))
    const window = selectHistoryWindow(msgs, 24)
    assert.equal(window.length, 24)
    assert.equal(window[0].id, 'm16')
    const prompt = buildAgentUserPrompt({
      history: window,
      inboundText: 'hola',
    })
    assert.match(prompt, /msg-39/)
    assert.doesNotMatch(prompt, /msg-0\b/)
  })
})

describe('soft-ai model allowlist', () => {
  it('allows grok-4.7 and grok-4.6, rejects others', () => {
    assert.equal(assertAllowedModel('grok-4.7'), 'grok-4.7')
    assert.equal(assertAllowedModel('grok-4.6'), 'grok-4.6')
    assert.deepEqual(CHAT_AGENT_MODEL_ALLOWLIST, ['grok-4.7', 'grok-4.6'])
    assert.equal(DEFAULT_CHAT_AGENT_MODEL, 'grok-4.7')
    assert.throws(() => assertAllowedModel('grok-4.5'), /SOFT_AI_MODEL_NOT_ALLOWED/)
    assert.throws(() => assertAllowedModel('gpt-4o'), /SOFT_AI_MODEL_NOT_ALLOWED/)
  })

  it('resolveSoftAiModel() with no override and no env returns grok-4.7', () => {
    const prev = process.env.SOFT_AI_XAI_MODEL
    delete process.env.SOFT_AI_XAI_MODEL
    try {
      assert.equal(resolveSoftAiModel(), 'grok-4.7')
      assert.equal(resolveSoftAiModel(null), 'grok-4.7')
      assert.equal(resolveSoftAiModel(''), 'grok-4.7')
      assert.equal(resolveSoftAiModel('grok-4.6'), 'grok-4.6')
    } finally {
      if (prev === undefined) delete process.env.SOFT_AI_XAI_MODEL
      else process.env.SOFT_AI_XAI_MODEL = prev
    }
  })

  it('stored grok-4.6 still passes the resolveChatAgent allowlist gate', () => {
    assert.equal(isAllowedChatAgentModel('grok-4.6'), true)
    assert.equal(isAllowedChatAgentModel('grok-4.7'), true)
    assert.equal(isAllowedChatAgentModel('grok-4.5'), false)
  })

  it('prices both allowlisted models at the shared short-context rates', () => {
    assert.equal(DEFAULT_PRICING_VERSION, 'xai-2026-09')
    const sample = {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
    }
    const cost47 = estimateCostMicros({ model: 'grok-4.7', ...sample })
    const cost46 = estimateCostMicros({ model: 'grok-4.6', ...sample })
    assert.equal(cost47, 8_000_000)
    assert.equal(cost46, cost47)
  })

  it('prompt cache key includes the model', () => {
    const base = {
      tenantId: 't',
      agentId: 'a',
      agentVersion: 3,
      socialAccountId: 's',
    }
    assert.equal(
      buildSoftAiPromptCacheKey({ ...base, model: 'grok-4.7' }),
      't:a:3:s:grok-4.7',
    )
    assert.notEqual(
      buildSoftAiPromptCacheKey({ ...base, model: 'grok-4.7' }),
      buildSoftAiPromptCacheKey({ ...base, model: 'grok-4.6' }),
    )
  })

  it('fixture hash has a single source (G7)', () => {
    assert.equal(FORGE_WA_V2_FIXTURE_SET_HASH, 'forge-wa-v2-al2-a1-2026-09-21')
    assert.equal(FIXTURE_SET_HASH_V2, FORGE_WA_V2_FIXTURE_SET_HASH)
    assert.equal(FIXTURE_HASH_REEXPORT, FORGE_WA_V2_FIXTURE_SET_HASH)
  })
})

describe('soft-ai outbound attribution (AT-WA-3, G23)', () => {
  it('labels a delivered agent from the metadata snapshot', () => {
    assert.equal(
      softAiOutboundLabel({
        softAi: true,
        agentId: 'agent-1',
        agentName: 'Forge ventas',
        agentEmoji: '🤖',
        turnId: 'turn-1',
      }),
      '🤖 Forge ventas envió',
    )
  })

  it('omits a blank emoji and trims the stored snapshot', () => {
    for (const agentEmoji of [undefined, null, '', '   ']) {
      assert.equal(
        softAiOutboundLabel({
          softAi: true,
          agentId: 'agent-1',
          agentName: 'Forge ventas',
          agentEmoji,
        }),
        'Forge ventas envió',
      )
    }
    assert.equal(
      softAiOutboundLabel({
        softAi: true,
        agentId: '  agent-1  ',
        agentName: '  Forge ventas  ',
        agentEmoji: '  🤖  ',
      }),
      '🤖 Forge ventas envió',
    )
  })

  it('keeps legacy and incomplete rows as IA envió', () => {
    assert.equal(softAiOutboundLabel({ softAi: true }), 'IA envió')
    assert.equal(softAiOutboundLabel({ softAi: true, toolLog: [] }), 'IA envió')
    assert.equal(softAiOutboundLabel({ softAi: true, agentId: 'agent-1' }), 'IA envió')
    assert.equal(
      softAiOutboundLabel({ softAi: true, agentId: 'agent-1', agentName: '   ' }),
      'IA envió',
    )
    assert.equal(
      softAiOutboundLabel({ softAi: true, agentName: 'Forge ventas', agentEmoji: '🤖' }),
      'IA envió',
    )
    assert.equal(softAiOutboundLabel(null), 'IA envió')
    assert.equal(softAiOutboundLabel([]), 'IA envió')
    assert.equal(softAiOutboundLabel('soft'), 'IA envió')
    assert.equal(
      softAiOutboundLabel({
        softAi: true,
        agentId: 12,
        agentName: 'Forge ventas',
        agentEmoji: '🤖',
      }),
      'IA envió',
    )
    assert.equal(
      softAiOutboundLabel({
        agentId: 'agent-1',
        agentName: 'Nombre actual',
        agentEmoji: '🔥',
      }),
      'IA envió',
    )
  })

  it('snapshots agentName and agentEmoji on the delivery write', () => {
    const turn = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(turn, /agentName: input\.agent\.name/)
    assert.match(turn, /agentEmoji: input\.agent\.emoji/)
  })
})

describe('soft-ai trust labels (1.20)', () => {
  it('formats header and state dots', () => {
    assert.equal(
      formatAgentHeaderLabel({ emoji: '✨', name: 'Forge ventas', operationMode: 'ai_suggest' }),
      'Agente: ✨ Forge ventas · Sugerir',
    )
    assert.equal(agentStateDot({ operationMode: 'ai_suggest', conversationAiMode: 'ai_active' }), 'Sug')
    assert.equal(agentStateDot({ operationMode: 'ai_full', conversationAiMode: 'human' }), 'Hum')
  })
})

describe('soft-ai output hash reuse (1.5)', () => {
  it('hashSoftAiOutput is stable', () => {
    assert.equal(hashSoftAiOutput('hola'), hashSoftAiOutput('hola'))
    assert.notEqual(hashSoftAiOutput('hola'), hashSoftAiOutput('adios'))
  })
})
