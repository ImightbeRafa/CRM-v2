import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

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

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (name === '__fixtures__' || name === '__tests__' || name === 'node_modules') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) acc.push(full)
  }
  return acc
}

/** Includes fixtures. Skips tests. Used by the model-id literal lock. */
function collectSoftAiLiterals(dir: string, acc: string[] = []): string[] {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (name === '__tests__' || name === 'node_modules') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) collectSoftAiLiterals(full, acc)
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith('.test.ts')) acc.push(full)
  }
  return acc
}

describe('chat-agent A1 locked directories (A1.11 / A1.21)', () => {
  it('soft-ai and chat API do not import the staff bot or read WHATSAPP_', () => {
    const files = [
      ...collectSourceFiles(join(ROOT, 'src/lib/soft-ai')),
      ...collectSourceFiles(join(ROOT, 'src/app/api/chat')),
    ]
    assert.ok(files.length > 10)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /process\.env\.WHATSAPP_/, relative(ROOT, file))
      assert.doesNotMatch(src, /from ['"]@\/lib\/bot\//, relative(ROOT, file))
      assert.doesNotMatch(src, /from ['"]@\/app\/api\/bot\//, relative(ROOT, file))
    }
  })

  it('P0–P2 modules do not import the staff bot or read WHATSAPP_', () => {
    // P2/P3 files (agent-turn-inputs, agent-turn-outcome, agent-layer-config-mutate,
    // test/unlock route) are covered by the recursive scan above once they exist.
    const files = [
      'src/lib/soft-ai/agent-types.ts',
      'src/lib/soft-ai/agent-admin.ts',
      'src/lib/soft-ai/shortcut-import-server.ts',
      'src/lib/soft-ai/llm/client.ts',
      'src/lib/soft-ai/llm/model-policy.ts',
      'src/lib/soft-ai/llm/runtime.ts',
      'src/lib/soft-ai/llm/usage.ts',
      'src/lib/soft-ai/agent-turn-inputs.ts',
      'src/lib/soft-ai/agent-turn-outcome.ts',
      'src/app/config/agentes/page.tsx',
    ]
    for (const rel of files) {
      assert.equal(existsSync(join(ROOT, rel)), true, rel)
      const src = readFileSync(join(ROOT, rel), 'utf8')
      assert.doesNotMatch(src, /process\.env\.WHATSAPP_/, rel)
      assert.doesNotMatch(src, /from ['"]@\/lib\/bot\//, rel)
      assert.doesNotMatch(src, /from ['"]@\/app\/api\/bot\//, rel)
    }
  })

  it('soft-ai sources have no grok-4.6 literal outside agent-types', () => {
    const files = collectSoftAiLiterals(join(ROOT, 'src/lib/soft-ai'))
    assert.ok(files.some((file) => file.endsWith('agent-types.ts')))
    for (const file of files) {
      if (file.endsWith(`${join('soft-ai', 'agent-types.ts')}`)) continue
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /grok-4\.6/, relative(ROOT, file))
    }
  })

  it('product agent paths have no hardcoded pilot account or brand name', () => {
    const files = [
      ...collectSourceFiles(join(ROOT, 'src/lib/soft-ai')),
      ...collectSourceFiles(join(ROOT, 'src/app/api/chat')),
      ...collectSourceFiles(join(ROOT, 'src/app/config/agentes')),
      ...collectSourceFiles(join(ROOT, 'src/components/chats')),
    ]
    const chatLib = readdirSync(join(ROOT, 'src/lib')).filter((name) => name.startsWith('chat-'))
    for (const name of chatLib) {
      const full = join(ROOT, 'src/lib', name)
      if (statSync(full).isFile() && /\.(ts|tsx)$/.test(name)) files.push(full)
    }
    const banned = /cmuahn5y90001l504y6kksiek|cmhsibjue0004js04gie724nx|Forge/
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, banned, relative(ROOT, file))
    }
  })
})

describe('chat-agent A1.5 SQL 027b (gated)', () => {
  it('ships additive introductionNames migration without touching Soft chrome', () => {
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/027b_chat_agent_introduction_names.sql'),
      'utf8',
    )
    assert.match(sql, /introductionNames/)
    assert.doesNotMatch(sql, /DROP TABLE/i)
    for (const rel of [
      'src/components/chats/SoftSlimNav.tsx',
      'src/components/chats/SoftInboxBuckets.tsx',
      'src/components/chats/SoftCopilotRail.tsx',
    ]) {
      assert.ok(readFileSync(join(ROOT, rel), 'utf8').length > 100)
    }
  })
})
