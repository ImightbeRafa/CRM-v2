import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  CHAT_INBOX_V2_FULL_RECONCILE_MS,
  CHAT_INBOX_V2_POLL_MS,
} from '../chat-inbox-v2-client'
import {
  assertIdleNetworkBudget,
  CHAT_IDLE_NETWORK_BUDGET_MS,
  evaluateIdleNetworkBudget,
} from '../../../scripts/chat-idle-network-assert'

describe('chat-idle-network-assert (acceptance 4.4)', () => {
  it('exports SoftCopilotInboxV2 poll ≤ 5000ms budget', () => {
    assert.ok(CHAT_INBOX_V2_POLL_MS > 0)
    assert.ok(CHAT_INBOX_V2_POLL_MS <= CHAT_IDLE_NETWORK_BUDGET_MS)
    assert.ok(CHAT_INBOX_V2_FULL_RECONCILE_MS >= CHAT_INBOX_V2_POLL_MS)
  })

  it('evaluateIdleNetworkBudget passes for current client constants', () => {
    const result = evaluateIdleNetworkBudget()
    assert.equal(result.pollMs, CHAT_INBOX_V2_POLL_MS)
    assert.equal(result.withinBudget, true)
    assertIdleNetworkBudget()
  })

  it('fails when poll is faster than 1 req / 5s', () => {
    const result = evaluateIdleNetworkBudget({ pollMs: 1000, budgetMs: 5000 })
    assert.equal(result.withinBudget, false)
  })

  it('SoftCopilotInboxV2 wires CHAT_INBOX_V2_POLL_MS for changes polling', () => {
    const source = readFileSync(
      new URL('../../components/chats/SoftCopilotInboxV2.tsx', import.meta.url),
      'utf8',
    )
    assert.match(source, /CHAT_INBOX_V2_POLL_MS/)
    assert.match(source, /conversations\/changes\?afterRevision=/)
  })
})
