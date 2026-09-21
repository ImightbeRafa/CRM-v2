import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORGE_WA_V1_FIXTURES, forgeWaFixtureSetHash } from '../soft-ai/__fixtures__/forge-wa-v1'

describe('chat-agent schema mirror (1.17)', () => {
  it('prisma schema includes ChatAgent* models and conversation turn index', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /model ChatAgent \{/)
    assert.match(schema, /model ChatAgentBinding \{/)
    assert.match(schema, /model ChatAgentTurn \{/)
    assert.match(schema, /@@index\(\[conversationId, createdAt\]\)/)
    assert.match(schema, /outputPurgedAt/)
    assert.match(schema, /skipReason/)
    assert.match(schema, /introductionNames/)
  })

  it('history index ChatMessage_conversationId_sentAt_id_idx remains in schema', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /ChatMessage_conversationId_sentAt_id_idx/)
  })
})

describe('forge WA fixtures (1.15 / 2.9)', () => {
  it('ships ≥30 fixtures and a stable hash', () => {
    assert.ok(FORGE_WA_V1_FIXTURES.length >= 30)
    assert.equal(forgeWaFixtureSetHash(), 'forge-wa-v1-a1-2026-09-21')
  })
})
