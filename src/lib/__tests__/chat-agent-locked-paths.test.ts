import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd())

describe('chat-agent locked paths (1.10 / 1.20)', () => {
  it('Soft chrome shells are unchanged in this PR scope marker', () => {
    // Presence check — CI also runs git diff --exit-code on these files.
    for (const rel of [
      'src/components/chats/SoftSlimNav.tsx',
      'src/components/chats/SoftInboxBuckets.tsx',
      'src/components/chats/SoftCopilotRail.tsx',
    ]) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      assert.ok(src.length > 100)
    }
  })

  it('Soft LLM client never reads WHATSAPP_* or imports staff bot', () => {
    const files = [
      'src/lib/soft-ai/llm/client.ts',
      'src/lib/soft-ai/llm/runtime.ts',
      'src/lib/soft-ai/agent-turn.ts',
      'src/lib/soft-ai/automation-processor.ts',
    ]
    for (const rel of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      assert.doesNotMatch(src, /process\.env\.WHATSAPP_/)
      assert.doesNotMatch(src, /from ['"]@\/lib\/bot\//)
      assert.doesNotMatch(src, /from ['"]@\/app\/api\/bot\//)
    }
  })

  it('SQL 027 defines ChatAgent tables + single-flight + outputPurgedAt', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/027_chat_agents.sql'), 'utf8')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgent"/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgentBinding"/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgentTurn"/)
    assert.match(sql, /outputPurgedAt/)
    assert.match(sql, /skipReason/)
    assert.match(sql, /ChatAgentTurn_conversationId_createdAt_idx/)
    assert.match(sql, /ChatAutomationJob_conversation_single_flight_idx/)
    assert.match(sql, /ChatAgentBinding_tenantId_agentId_fkey/)
  })
})
