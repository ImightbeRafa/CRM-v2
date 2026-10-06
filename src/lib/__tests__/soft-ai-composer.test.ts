/**
 * F37-03 — Soft human composer unlocked when paused / human takeover (not only AI-off).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  applyAgentControl,
  getConversationAgentState,
  isSoftHumanComposerEnabled,
} from '../soft-ai/agent-state'

describe('F37-03 soft human composer after Pausar / Tomar control', () => {
  it('composer enabled for paused and human; disabled for ai_active', () => {
    assert.equal(isSoftHumanComposerEnabled('ai_active'), false)
    assert.equal(isSoftHumanComposerEnabled('paused'), true)
    assert.equal(isSoftHumanComposerEnabled('human'), true)
  })

  it('take_over / pause unlock composer; resume locks it again', () => {
    let map = {}
    map = applyAgentControl(map, 'sa::peer', 'pause', true)
    assert.equal(isSoftHumanComposerEnabled(getConversationAgentState(map, 'sa::peer', true).mode), true)
    map = applyAgentControl(map, 'sa::peer', 'resume', true)
    assert.equal(isSoftHumanComposerEnabled(getConversationAgentState(map, 'sa::peer', true).mode), false)
    map = applyAgentControl(map, 'sa::peer', 'take_over', true)
    assert.equal(isSoftHumanComposerEnabled(getConversationAgentState(map, 'sa::peer', true).mode), true)
  })

  it('SoftThreadPane does not blanket-disable DEMO composer when human mode', () => {
    const src = readFileSync(resolve('src/components/chats/SoftThreadPane.tsx'), 'utf8')
    assert.match(src, /isSoftHumanComposerEnabled/)
    assert.match(src, /F37-03/)
    // Old DEMO blanket disable must be gone from input + Enviar
    assert.doesNotMatch(
      src,
      /disabled=\{sending \|\| Boolean\(conversation\.isDemo\) \|\| !composerEnabled\}/,
    )
    assert.doesNotMatch(
      src,
      /Boolean\(conversation\.isDemo\) \|\|\s*!composerEnabled/,
    )
    assert.match(src, /disabled=\{sending \|\| !composerEnabled\}/)
    // Enviar: disabled only while a file / media send is uploading, with nothing to send (no text, no
    // attached or recent file), or composer off. A text send in flight never locks it (sends queue).
    assert.match(src, /const hasAttachment = Boolean\(pendingFile \|\| pendingRecent \|\| pendingQuickMedia\.length\)/)
    assert.match(src, /const mediaSending = sending && hasAttachment/)
    assert.match(src, /disabled=\{mediaSending \|\| \(!messageInput\.trim\(\) && !hasAttachment\) \|\| !composerEnabled\}/)
  })

  it('SoftCopilotInbox allows DEMO local human send after pause/takeover', () => {
    const src = readFileSync(resolve('src/components/chats/SoftCopilotInboxLegacy.tsx'), 'utf8')
    assert.match(src, /F37-03/)
    assert.match(src, /demo-human-/)
    assert.match(src, /mode !== 'paused' && mode !== 'human'/)
  })
})
