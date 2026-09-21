import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTPUT_RETENTION_DAYS } from '../soft-ai/agent-types'

describe('soft-ai agent retention contract (1.18)', () => {
  it('locks 90-day retention constant and purge module API', async () => {
    assert.equal(OUTPUT_RETENTION_DAYS, 90)
    const mod = await import('../soft-ai/agent-retention')
    assert.equal(typeof mod.purgeChatAgentOutputs, 'function')
  })

  it('cron route exists and documents TODO for heavy batches', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/cron/chat-agent-retention/route.ts'),
      'utf8',
    )
    assert.match(src, /purgeChatAgentOutputs/)
    assert.match(src, /TODO/)
  })
})
