import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeEffectiveBehavior } from '../soft-ai/agent-resolver'
import { hasAiFullUnlock, parseChatAgentLayerConfig } from '../soft-ai/agent-config'
import { FIXTURE_SOCIAL_ACCOUNT_ID } from '../soft-ai/__fixtures__/forge-wa-v2'
import { FORGE_WA_V1_FIXTURE_SET_HASH } from '../soft-ai/__fixtures__/forge-wa-v1'
import { validateAgentOutput } from '../soft-ai/llm/output-validator'
import { selectHistoryWindow, buildAgentUserPrompt } from '../soft-ai/llm/prompt'
import { assertAllowedModel } from '../soft-ai/llm/model-policy'
import { formatAgentHeaderLabel, agentStateDot } from '../soft-ai/agent-inbox-projection'
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
  it('rejects non-grok-4.6', () => {
    assert.equal(assertAllowedModel('grok-4.6'), 'grok-4.6')
    assert.throws(() => assertAllowedModel('gpt-4o'), /SOFT_AI_MODEL_NOT_ALLOWED/)
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
