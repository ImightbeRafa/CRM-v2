/**
 * F37-02 — Soft AI pause/takeover is server-truth; inbound must not Meta-reply when paused/human.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  maySoftAiMetaReply,
  resolvePersistedAgentMode,
  softAiConversationKey,
} from '../soft-ai/agent-mode-server'

describe('F37-02 soft-ai server-truth agent mode', () => {
  const key = softAiConversationKey('sa-1', '50688880001')

  it('missing agentState / missing key does NOT silently become ai_active', () => {
    assert.equal(resolvePersistedAgentMode({}, key), null)
    assert.equal(resolvePersistedAgentMode({ agentState: {} }, key), null)
    assert.equal(resolvePersistedAgentMode(null, key), null)
    assert.equal(resolvePersistedAgentMode(undefined, key), null)
    assert.equal(maySoftAiMetaReply(null), false)
    assert.equal(maySoftAiMetaReply(resolvePersistedAgentMode({}, key)), false)
  })

  it('pause and human takeover block Meta reply; explicit ai_active allows', () => {
    assert.equal(
      maySoftAiMetaReply(
        resolvePersistedAgentMode(
          { agentState: { [key]: { mode: 'paused', action: 'pause' } } },
          key,
        ),
      ),
      false,
    )
    assert.equal(
      maySoftAiMetaReply(
        resolvePersistedAgentMode(
          { agentState: { [key]: { mode: 'human', action: 'take_over' } } },
          key,
        ),
      ),
      false,
    )
    assert.equal(
      maySoftAiMetaReply(
        resolvePersistedAgentMode(
          { agentState: { [key]: { mode: 'human_takeover', action: 'take_over' } } },
          key,
        ),
      ),
      false,
    )
    assert.equal(
      maySoftAiMetaReply(
        resolvePersistedAgentMode(
          { agentState: { [key]: { mode: 'ai_active', action: 'resume' } } },
          key,
        ),
      ),
      true,
    )
  })

  it('re-read before send: paused/human after worker would block Meta (literal gate)', () => {
    // Simulates F37-02 pre-send re-read sequence
    const beforeWorker = resolvePersistedAgentMode(
      { agentState: { [key]: { mode: 'ai_active' } } },
      key,
    )
    assert.equal(maySoftAiMetaReply(beforeWorker), true)

    const afterStaffPause = resolvePersistedAgentMode(
      { agentState: { [key]: { mode: 'paused', action: 'pause', staffControlled: true } } },
      key,
    )
    assert.equal(maySoftAiMetaReply(afterStaffPause), false)

    const afterTakeover = resolvePersistedAgentMode(
      { agentState: { [key]: { mode: 'human', action: 'take_over', staffControlled: true } } },
      key,
    )
    assert.equal(maySoftAiMetaReply(afterTakeover), false)
  })

  it('inbound-hook source re-reads mode before Meta send and uses maySoftAiMetaReply', () => {
    const src = readFileSync(resolve('src/lib/soft-ai/inbound-hook.ts'), 'utf8')
    assert.match(src, /resolvePersistedAgentMode/)
    assert.match(src, /maySoftAiMetaReply/)
    assert.match(src, /modeBeforeSend/)
    assert.match(src, /missing_or_non_explicit_mode|paused_before_send|human_before_send/)
    assert.doesNotMatch(src, /return 'ai_active'\s*\n\s*\}/)
    // Old silent default must be gone
    assert.doesNotMatch(
      src,
      /if \(!agentState[\s\S]*?\) return 'ai_active'/,
    )
  })

  it('SoftCopilotInbox awaits control API before committing UI mode (non-demo)', () => {
    const src = readFileSync(resolve('src/components/chats/SoftCopilotInbox.tsx'), 'utf8')
    assert.match(src, /await fetch\('\/api\/chat\/soft-ai\/control'/)
    assert.match(src, /F37-02/)
    // Must not fire-and-forget void fetch for control anymore
    assert.doesNotMatch(src, /void fetch\('\/api\/chat\/soft-ai\/control'/)
    // Commit UI only after success check
    const awaitIdx = src.indexOf("await fetch('/api/chat/soft-ai/control'")
    const commitIdx = src.indexOf('setAgentStateMap(next)', awaitIdx)
    assert.ok(awaitIdx > 0)
    assert.ok(commitIdx > awaitIdx)
  })

  it('control route persists staffControlled agentState server-side', () => {
    const src = readFileSync(resolve('src/app/api/chat/soft-ai/control/route.ts'), 'utf8')
    assert.match(src, /staffControlled/)
    assert.match(src, /agentState\[conversationKey\]/)
  })
})
