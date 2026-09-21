import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const migrationPath = join(root, 'supabase/migrations/024_chat_inbox_conversations.sql')
const manifestUrl = pathToFileURL(join(root, 'scripts/lib/betsy-v2-additive-manifest.mjs')).href

describe('024 chat inbox schema contract', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('is expand-only with timeouts and no destructive DDL', () => {
    assert.match(sql, /\bBEGIN\b/)
    assert.match(sql, /lock_timeout\s*=\s*'3s'/)
    assert.match(sql, /statement_timeout\s*=\s*'30s'/)
    assert.match(sql, /IF NOT EXISTS/)
    assert.doesNotMatch(sql, /\bDROP TABLE\b/i)
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i)
    assert.doesNotMatch(sql, /ALTER TABLE[\s\S]{0,80}DROP COLUMN/i)
  })

  it('creates conversation tables, revision sequence/trigger, and RLS', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatConversation"/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatConversationReadState"/)
    assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS public\."ChatConversation_revision_seq"/)
    assert.match(sql, /ChatConversation_revision_trg/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /service_role_bypass/)
    assert.match(sql, /DEFAULT 'nuevo'/)
    assert.doesNotMatch(sql, /ADD COLUMN[^;]*"snoozedUntil"/i)
    assert.doesNotMatch(sql, /"snoozedUntil"\s+timestamp/i)
    assert.doesNotMatch(sql, /"closedAt"\s+timestamp/i)
  })

  it('adds SocialAccount + ChatMessage nullable columns and non-unique provider index', () => {
    assert.match(sql, /"displayName"/)
    assert.match(sql, /"tokenStatus"/)
    assert.match(sql, /"wabaId"/)
    assert.match(sql, /"conversationId"/)
    assert.match(sql, /"providerMessageId"/)
    assert.match(sql, /"duplicateOfMessageId"/)
    assert.match(sql, /ChatMessage_socialAccountId_providerMessageId_idx/)
  })

  it('does not ship 025 unique constraints', () => {
    assert.doesNotMatch(
      sql,
      /UNIQUE\s+INDEX[\s\S]{0,200}providerMessageId/i,
    )
    assert.doesNotMatch(
      sql,
      /UNIQUE[\s\S]{0,120}"platform"[\s\S]{0,40}"accountId"[\s\S]{0,80}isActive/i,
    )
  })

  it('manifest registers 024 and not 025', async () => {
    const manifest = await import(manifestUrl)
    assert.equal(manifest.FILES['024'], '024_chat_inbox_conversations.sql')
    assert.equal(manifest.FILES['025'], undefined)
    assert.ok(manifest.DEFAULT_APPLY_FILES.includes('024'))
    assert.ok(!manifest.DEFAULT_APPLY_FILES.includes('025'))
    assert.deepEqual(manifest.EXPECTED_TABLES['024'], [
      'ChatConversation',
      'ChatConversationReadState',
    ])
    assert.ok(manifest.EXPECTED_COLUMNS['024'].some(([t, c]: [string, string]) => t === 'ChatMessage' && c === 'conversationId'))
    assert.ok(manifest.EXPECTED_INDEXES_024.includes('ChatMessage_socialAccountId_providerMessageId_idx'))
  })
})
