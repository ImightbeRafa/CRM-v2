import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORGE_WA_V1_FIXTURES, forgeWaFixtureSetHash } from '../soft-ai/__fixtures__/forge-wa-v1'
import { FORGE_WA_V2_FIXTURES, forgeWaV2FixtureSetHash } from '../soft-ai/__fixtures__/forge-wa-v2'

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
    assert.match(schema, /brandFacts/)
    assert.match(schema, /model ChatAgentShortcut/)
    assert.match(schema, /model ChatAgentAsset/)
    assert.match(schema, /conversationId\s+String\?/)
  })

  it('history index ChatMessage_conversationId_sentAt_id_idx remains in schema', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /ChatMessage_conversationId_sentAt_id_idx/)
  })
})

describe('SQL 029 gated playbooks (AL2-A1)', () => {
  it('ships additive 029 and keeps it out of the default apply set', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/029_chat_agent_playbooks_assets.sql'),
      'utf8',
    )
    const manifest = readFileSync(
      join(process.cwd(), 'scripts/lib/betsy-v2-additive-manifest.mjs'),
      'utf8',
    )
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgentShortcut"/)
    assert.match(sql, /brandFacts/)
    assert.match(sql, /BETSY_V2_APPLY_FILES=029/)
    assert.doesNotMatch(sql, /DROP TABLE/i)
    assert.match(manifest, /'029':\s*'029_chat_agent_playbooks_assets\.sql'/)
    assert.doesNotMatch(manifest, /DEFAULT_APPLY_FILES\s*=\s*'[^']*029/)
  })

  it('fixture set v2 has at least 45 cases and a stable hash', () => {
    assert.ok(FORGE_WA_V2_FIXTURES.length >= 45)
    assert.equal(forgeWaV2FixtureSetHash(), 'forge-wa-v2-al2-a1-2026-09-21')
  })
})

describe('forge WA fixtures (1.15 / 2.9)', () => {
  it('ships ≥30 fixtures and a stable hash', () => {
    assert.ok(FORGE_WA_V1_FIXTURES.length >= 30)
    assert.equal(forgeWaFixtureSetHash(), 'forge-wa-v1-a1-2026-09-21')
  })
})
