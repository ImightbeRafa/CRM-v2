/**
 * P2 — live / Probar runtime parity (AT-P-1, AT-P-2, offline AT-WA-2).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseBrandFactsSafe, parseReplyStyleSafe } from '../soft-ai/brand-facts'
import { decideInbound } from '../soft-ai/inbound-decision'
import {
  assembleAgentRuntimeInputs,
  channelBindingBlocker,
  chatHistoryWhere,
  effectiveEnabledTools,
  windowedAgentHistory,
  type RuntimeCanalAccount,
} from '../soft-ai/agent-turn-inputs'
import { decideTurnOutcome } from '../soft-ai/agent-turn-outcome'
import { collectDryRunBlockers } from '../soft-ai/agent-claim-gates'
import { parseAgentTestRequest } from '../soft-ai/agent-test-schema'
import { buildAgentSystemInstructions, buildAgentUserPrompt } from '../soft-ai/llm/prompt'
import { softAiToolDefinitions } from '../soft-ai/llm/tool-definitions'
import { HISTORY_WINDOW_MAX } from '../soft-ai/agent-types'
import type { ResolvedChatAgent } from '../soft-ai/agent-resolver'

const ROOT = process.cwd()

function filesUnder(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) filesUnder(full, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full)
  }
  return acc
}

function agent(enabledTools: string[]): ResolvedChatAgent {
  return {
    id: 'agent-1',
    tenantId: 'tenant-1',
    name: 'Ventas',
    emoji: '💬',
    description: 'Atiende WhatsApp',
    systemInstructions: 'Respondé breve.',
    tonePreset: 'warm_concise',
    model: 'grok-4.7',
    operationMode: 'ai_full',
    enabledTools,
    introductionNames: ['Betsy'],
    brandFacts: parseBrandFactsSafe({}),
    replyStyle: parseReplyStyleSafe({}),
    status: 'live',
    version: 3,
  }
}

const account: RuntimeCanalAccount = {
  found: true,
  id: 'acct-1',
  platform: 'whatsapp',
  accountId: '50661043737',
  displayName: 'Tienda',
}

function assemblyFor(label: 'live' | 'probar') {
  const row = agent(['search_inventory'])
  const decision = decideInbound({
    inboundText: 'precio con envío?',
    messageType: 'text',
    brandFacts: row.brandFacts,
    replyStyle: row.replyStyle,
    shortcuts: [],
  })
  const history = windowedAgentHistory([
    { id: 'h1', direction: 'inbound', content: 'hola', sentAt: '2026-09-22T00:00:00.000Z' },
    { id: 'h2', direction: 'outbound', content: 'hola', sentAt: '2026-09-22T00:00:01.000Z' },
  ])
  return assembleAgentRuntimeInputs({
    agent: row,
    account,
    history,
    inboundText: 'precio con envío?',
    clientName: 'María',
    shortcuts: [],
    knowledge: null,
    decision,
    toolCtxBase: {
      tenantId: 'tenant-1',
      conversationId: label === 'live' ? 'conv-1' : 'sandbox',
      socialAccountId: account.id,
      peerId: label === 'live' ? 'peer-1' : 'sandbox-peer',
      clientId: null,
      ...(label === 'probar' ? { sandbox: true } : {}),
    },
  })
}

describe('agent turn parity', () => {
  it('forces search_approved_knowledge and does not force use_shortcut', () => {
    const bare = effectiveEnabledTools(['search_inventory', 'search_inventory'])
    assert.deepEqual(bare, ['search_inventory', 'search_approved_knowledge'])
    assert.equal(bare.includes('use_shortcut'), false)

    const kept = effectiveEnabledTools(['use_shortcut', 'search_approved_knowledge', 'use_shortcut'])
    assert.deepEqual(kept, ['use_shortcut', 'search_approved_knowledge'])
  })

  it('AT-P-1 identical agent, account, history and inbound assemble the same prompt', () => {
    const live = assemblyFor('live')
    const probar = assemblyFor('probar')
    const livePrompt = {
      instructions: buildAgentSystemInstructions({
        systemInstructions: live.systemInstructions,
        tonePreset: live.tonePreset,
        description: live.description,
        canalContext: live.canalContext,
        introductionNames: live.introductionNames,
        knowledge: live.knowledge,
        brandFactsBlock: live.brandFactsBlock,
        shortcutCatalog: live.shortcutCatalog,
        replyStyleSnippet: live.replyStyleSnippet,
      }).instructions,
      user: buildAgentUserPrompt({
        history: live.history,
        inboundText: live.inboundText,
        clientName: live.clientName,
        linkedOrderId: live.linkedOrderId,
      }),
      tools: softAiToolDefinitions(live.enabledTools).map((tool) => tool.name),
      canal: live.canalContext,
    }
    const probarPrompt = {
      instructions: buildAgentSystemInstructions({
        systemInstructions: probar.systemInstructions,
        tonePreset: probar.tonePreset,
        description: probar.description,
        canalContext: probar.canalContext,
        introductionNames: probar.introductionNames,
        knowledge: probar.knowledge,
        brandFactsBlock: probar.brandFactsBlock,
        shortcutCatalog: probar.shortcutCatalog,
        replyStyleSnippet: probar.replyStyleSnippet,
      }).instructions,
      user: buildAgentUserPrompt({
        history: probar.history,
        inboundText: probar.inboundText,
        clientName: probar.clientName,
        linkedOrderId: probar.linkedOrderId,
      }),
      tools: softAiToolDefinitions(probar.enabledTools).map((tool) => tool.name),
      canal: probar.canalContext,
    }
    assert.deepEqual(probarPrompt, livePrompt)
    assert.match(livePrompt.user, /María/)
    assert.match(String(livePrompt.canal), /Tienda/)
    assert.deepEqual(live.enabledTools, ['search_inventory', 'search_approved_knowledge'])
    assert.equal(live.enabledTools.includes('use_shortcut'), false)
    assert.equal(live.toolCtx.conversationId, 'conv-1')
    assert.equal(probar.toolCtx.conversationId, 'sandbox')
    assert.equal(probar.toolCtx.sandbox, true)
  })

  it('runSoftAiLlmRuntime is only called with the shared assembly', () => {
    const callers: string[] = []
    for (const file of [
      ...filesUnder(join(ROOT, 'src/lib')),
      ...filesUnder(join(ROOT, 'src/app')),
    ]) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('runSoftAiLlmRuntime(')) continue
      if (file.endsWith(`${join('llm', 'runtime.ts')}`)) continue
      callers.push(relative(ROOT, file))
      assert.doesNotMatch(src, /runSoftAiLlmRuntime\(\s*\{/, relative(ROOT, file))
    }
    assert.deepEqual(callers, ['src/lib/soft-ai/agent-turn.ts'])
    const turn = readFileSync(join(ROOT, 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.equal((turn.match(/assembleAgentRuntimeInputs\(/g) || []).length, 2)
    assert.equal((turn.match(/runSoftAiLlmRuntime\(/g) || []).length, 2)
    assert.match(turn, /const wouldSend = outcome\.outcome === 'send'/)
    assert.doesNotMatch(turn, /use_shortcut/)
  })

  it('AT-WA-2 offline decideTurnOutcome table', () => {
    const base = {
      effectiveBehavior: 'send' as const,
      unlockedForSend: true,
      needsHuman: false,
      fallbackUsed: false,
      escalate: false,
      conversationAiMode: 'ai_active' as const,
      gateBlockers: [] as string[],
    }
    assert.deepEqual(decideTurnOutcome(base), { outcome: 'send', reason: null })
    assert.deepEqual(decideTurnOutcome({ ...base, effectiveBehavior: 'suggest' }), {
      outcome: 'suggest',
      reason: 'ai_suggest',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, unlockedForSend: false }), {
      outcome: 'suggest',
      reason: 'ai_full_not_unlocked',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, gateBlockers: ['ai_full_not_unlocked'] }), {
      outcome: 'suggest',
      reason: 'ai_full_not_unlocked',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, needsHuman: true }), {
      outcome: 'suggest',
      reason: 'needs_human',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, fallbackUsed: true, needsHuman: true }), {
      outcome: 'suggest',
      reason: 'fallback_used',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, escalate: true }), {
      outcome: 'suggest',
      reason: 'escalate',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, conversationAiMode: 'human' }), {
      outcome: 'skip',
      reason: 'human_before_send',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, conversationAiMode: 'paused' }), {
      outcome: 'skip',
      reason: 'paused_before_send',
    })
    assert.deepEqual(decideTurnOutcome({ ...base, conversationAiMode: null }), {
      outcome: 'skip',
      reason: 'missing_mode',
    })
    for (const reason of ['token_unhealthy', 'stale_version', 'human_replied', 'window_closed', 'not_bound_to_channel']) {
      assert.deepEqual(decideTurnOutcome({ ...base, gateBlockers: [reason] }), {
        outcome: 'skip',
        reason,
      })
    }
    const beforeSend = decideTurnOutcome(base)
    const flipped = decideTurnOutcome({ ...base, conversationAiMode: 'human' })
    assert.equal(beforeSend.outcome, 'send')
    assert.deepEqual(flipped, { outcome: 'skip', reason: 'human_before_send' })
  })

  it('history excludes the trigger and windows 40 inputs to 24', () => {
    const where = chatHistoryWhere('conv-1', 'trigger-1')
    assert.deepEqual(where, { conversationId: 'conv-1', id: { not: 'trigger-1' } })
    const rows = [
      { id: 'older', direction: 'inbound' as const, content: 'hola', sentAt: 't0' },
      { id: 'trigger-1', direction: 'inbound' as const, content: 'precio con envío?', sentAt: 't1' },
    ]
    const history = rows.filter((row) => row.id !== where.id.not)
    const prompt = buildAgentUserPrompt({ history, inboundText: 'precio con envío?' })
    assert.equal(prompt.split('precio con envío?').length - 1, 1)
    assert.match(prompt, /hola/)

    const forty = Array.from({ length: 40 }, (_, index) => ({
      id: `m-${index}`,
      direction: index % 2 === 0 ? ('inbound' as const) : ('outbound' as const),
      content: `msg-${index}`,
      sentAt: `t${index}`,
    }))
    const windowed = windowedAgentHistory(forty)
    assert.equal(windowed.length, HISTORY_WINDOW_MAX)
    assert.equal(windowed.length, 24)
    assert.equal(windowed[0]?.id, 'm-16')
    assert.equal(windowed.at(-1)?.id, 'm-39')

    const turn = readFileSync(join(ROOT, 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(turn, /chatHistoryWhere\(conversationId, triggerMessageId\)/)
    assert.match(turn, /take: HISTORY_WINDOW_MAX/)
    assert.match(turn, /windowedAgentHistory\(/)
    assert.match(turn, /historyCount = history\.length/)
  })

  it('not_bound_to_channel blocks a different serving agent', () => {
    assert.equal(channelBindingBlocker('agent-a', 'agent-a'), null)
    assert.equal(channelBindingBlocker('agent-a', 'agent-b'), 'not_bound_to_channel')
    assert.equal(channelBindingBlocker('agent-a', null), 'not_bound_to_channel')
    const blocked = collectDryRunBlockers({
      layerEnabled: true,
      softEnabled: true,
      allowlisted: true,
      boundToChannel: false,
      operationMode: 'ai_full',
      unlockedForSend: true,
      windowOpen: true,
      agentStatus: 'live',
      conversationAiMode: 'ai_active',
    })
    assert.deepEqual(blocked, ['not_bound_to_channel'])
    const turn = readFileSync(join(ROOT, 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(turn, /not_bound_to_channel/)
    assert.match(turn, /blockedBy\.includes\('not_bound_to_channel'\)/)
  })

  it('optional Probar inputs parse customer name and conversation mode', () => {
    const parsed = parseAgentTestRequest({
      inboundText: 'y a Heredia?',
      socialAccountId: 'acct-1',
      testSessionId: '11111111-1111-4111-8111-111111111111',
      customerName: '  María  ',
      conversationAiMode: 'paused',
    })
    assert.equal(parsed.customerName, 'María')
    assert.equal(parsed.conversationAiMode, 'paused')
    const blank = parseAgentTestRequest({
      inboundText: 'hola',
      socialAccountId: 'acct-1',
      testSessionId: '11111111-1111-4111-8111-111111111111',
      customerName: '   ',
    })
    assert.equal(blank.customerName, undefined)
    assert.equal(blank.conversationAiMode, 'ai_active')
    const turn = readFileSync(join(ROOT, 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.match(turn, /clientName: input\.customerName \?\? null/)
  })
})
