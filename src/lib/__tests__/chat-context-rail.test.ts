/** Phase 2a slice B (2026-09-29): Cliente · Agente rail, notes + client stage inside Cliente. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeRailTab } from '../../components/chats/ChatContextRail'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('old remembered tabs map onto Cliente / Agente', () => {
  assert.equal(normalizeRailTab('detalle'), 'cliente')
  assert.equal(normalizeRailTab('cliente'), 'cliente')
  assert.equal(normalizeRailTab('copilot'), 'agente')
  assert.equal(normalizeRailTab('agente'), 'agente')
  assert.equal(normalizeRailTab(null), 'cliente')
})

test('V2 inbox uses the new rail on desktop and mobile; locked rail untouched and unused there', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.equal((inbox.match(/<ChatContextRail\b/g) || []).length, 2)
  assert.doesNotMatch(inbox, /<SoftCopilotRail\b/)
  assert.doesNotMatch(inbox, /TAG_FILTERS/)
  assert.match(inbox, /tags=\{activeTags\.map\(\(t\) => t\.key\)\}/)
})

test('Cliente tab: chat stage + tags from the catalog, client panel with stage chip and notes', () => {
  const rail = read('src/components/chats/ChatContextRail.tsx')
  assert.match(rail, /useCrmCatalog\(\)/)
  assert.match(rail, /onStatusChange\(s\.key\)/)
  const panel = read('src/components/chats/ChatClientPanel.tsx')
  assert.match(panel, /<ClientStageChip/)
  assert.match(panel, /<ChatNotesPanel conversationId=\{conversationId\}/)
  assert.doesNotMatch(panel, /Cliente recurrente<\/p>/, 'the stage replaces the old badge')
  assert.match(read('src/components/chats/ChatNotesPanel.tsx'), /el cliente no la ve/)
})

test('thread header shows the business stage label', () => {
  const pane = read('src/components/chats/SoftThreadPane.tsx')
  assert.match(pane, /chatStageLabel\(conversation\.status\)/)
  assert.doesNotMatch(pane, /function statusLabel/)
})
