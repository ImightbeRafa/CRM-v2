import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_SOFT_AI_CONFIG,
  isPaymentSensitiveText,
  parseSoftAiConfig,
} from '../soft-ai/config'
import { applyAgentControl, getConversationAgentState } from '../soft-ai/agent-state'
import { runSoftAiTurn } from '../soft-ai/worker'
import { runSoftDemoAiPass } from '../soft-ai/demo-runner'
import { buildSoftDemoConversations } from '../soft-demo-chats'
import { conversationStorageKey } from '../chat-soft-copilot'

describe('soft-ai config skeleton', () => {
  it('defaults paymentAlwaysHuman true and parses allowlist', () => {
    assert.equal(DEFAULT_SOFT_AI_CONFIG.paymentAlwaysHuman, true)
    const parsed = parseSoftAiConfig({
      personality: 'Cortés y breve',
      kb: ['Envíos Correos CR'],
      toolAllowlist: ['correos_guia', 'tag_chat'],
    })
    assert.equal(parsed.personality, 'Cortés y breve')
    assert.deepEqual(parsed.toolAllowlist, ['correos_guia', 'tag_chat'])
    assert.equal(parsed.paymentAlwaysHuman, true)
    assert.equal(isPaymentSensitiveText('te paso el SINPE'), true)
    assert.equal(isPaymentSensitiveText('¿dónde está la guía?'), false)
  })
})

describe('soft-ai worker tools + full reply', () => {
  it('creates demo order + correos guía stub and replies fully (not a draft)', async () => {
    const result = await runSoftAiTurn({
      conversationKey: 'demo::1',
      recipientId: '50688880001',
      recipientName: 'María Soto',
      platform: 'whatsapp',
      messages: [
        {
          id: '1',
          direction: 'inbound',
          content: '¿Me pasás la guía del pedido ORDER-8842?',
          sentAt: new Date().toISOString(),
        },
      ],
      agentMode: 'ai_active',
      config: DEFAULT_SOFT_AI_CONFIG,
      tags: ['Nuevo'],
      orderId: null,
      demo: true,
      nowMs: 1_700_000_000_000,
    })

    assert.equal(result.skipped, false)
    assert.ok(result.reply && result.reply.length > 20)
    assert.match(result.reply, /Hola María/i)
    assert.ok(result.orderId)
    assert.match(String(result.orderId), /8842|DEMO/i)
    const tools = result.toolLog.map((t) => t.tool)
    assert.ok(tools.includes('create_or_link_order'))
    assert.ok(tools.includes('correos_guia'))
    assert.ok(tools.includes('tag_chat'))
    const guia = result.toolLog.find((t) => t.tool === 'correos_guia')
    assert.ok(guia)
    assert.equal(guia!.result.source, 'stub')
    assert.ok(result.tags.includes('Envío'))
  })

  it('payment / SINPE always escalates to human', async () => {
    const result = await runSoftAiTurn({
      conversationKey: 'demo::pay',
      recipientId: '1',
      recipientName: 'Carlos',
      platform: 'whatsapp',
      messages: [
        {
          id: '1',
          direction: 'inbound',
          content: 'Te paso el SINPE ya',
          sentAt: new Date().toISOString(),
        },
      ],
      agentMode: 'ai_active',
      config: DEFAULT_SOFT_AI_CONFIG,
      tags: [],
      demo: true,
    })
    assert.equal(result.paymentBlocked, true)
    assert.equal(result.agentMode, 'human')
    assert.ok(result.toolLog.some((t) => t.tool === 'escalate_to_human'))
    assert.match(result.reply || '', /SINPE|humano|persona/i)
  })

  it('skips when paused or human takeover', async () => {
    const paused = await runSoftAiTurn({
      conversationKey: 'k',
      recipientId: '1',
      platform: 'whatsapp',
      messages: [
        { id: '1', direction: 'inbound', content: 'hola', sentAt: new Date().toISOString() },
      ],
      agentMode: 'paused',
      config: DEFAULT_SOFT_AI_CONFIG,
      tags: [],
      demo: true,
    })
    assert.equal(paused.skipped, true)
    assert.equal(paused.skipReason, 'paused')
    assert.equal(paused.reply, null)

    const human = await runSoftAiTurn({
      conversationKey: 'k',
      recipientId: '1',
      platform: 'whatsapp',
      messages: [
        { id: '1', direction: 'inbound', content: 'hola', sentAt: new Date().toISOString() },
      ],
      agentMode: 'human',
      config: DEFAULT_SOFT_AI_CONFIG,
      tags: [],
      demo: true,
    })
    assert.equal(human.skipped, true)
    assert.equal(human.skipReason, 'human')
  })
})

describe('soft-ai agent control', () => {
  it('take over / pause / resume transitions', () => {
    let map = {}
    map = applyAgentControl(map, 'a::b', 'pause', true)
    assert.equal(getConversationAgentState(map, 'a::b', true).mode, 'paused')
    map = applyAgentControl(map, 'a::b', 'resume', true)
    assert.equal(getConversationAgentState(map, 'a::b', true).mode, 'ai_active')
    map = applyAgentControl(map, 'a::b', 'take_over', true)
    assert.equal(getConversationAgentState(map, 'a::b', true).mode, 'human')
  })
})

describe('soft DEMO e2e without Meta', () => {
  it('AI replies alone, creates test order, guía stub, supports takeover state', async () => {
    const seed = buildSoftDemoConversations(1_700_000_000_000)
    const pass = await runSoftDemoAiPass({
      conversations: seed,
      agentState: {},
      nowMs: 1_700_000_000_000,
    })

    assert.ok(pass.repliedKeys.length >= 2, `expected AI replies, got ${pass.repliedKeys.length}`)

    const trackingKey = conversationStorageKey(
      'demo-soft-account-wa',
      'demo-wa-50688880001',
    )
    const tracking = pass.conversations.find(
      (c) => conversationStorageKey(c.socialAccountId, c.recipientId) === trackingKey,
    )
    assert.ok(tracking)
    const last = tracking!.messages[tracking!.messages.length - 1]
    assert.equal(last.direction, 'outbound')
    assert.match(last.content, /gu[ií]a|pedido|DEMO/i)
    assert.ok(tracking!.orderId)

    const state = getConversationAgentState(pass.agentState, trackingKey, true)
    assert.ok(state.toolLog.some((t) => t.tool === 'correos_guia'))
    assert.ok(state.toolLog.some((t) => t.tool === 'create_or_link_order'))

    const afterTakeover = applyAgentControl(pass.agentState, trackingKey, 'take_over', true)
    const blocked = await runSoftDemoAiPass({
      conversations: pass.conversations,
      agentState: afterTakeover,
      nowMs: 1_700_000_000_100,
    })
    // No new AI replies while human mode (messages already ended outbound or human)
    assert.equal(blocked.repliedKeys.length, 0)
    assert.equal(getConversationAgentState(blocked.agentState, trackingKey, true).mode, 'human')
  })
})
