/**
 * Staff bot boundary (Rafael, 2026-10-08): the staff bot (src/lib/bot/**, src/app/api/bot/**) is never changed,
 * with ONE approved exception — AI usage recording (recordAiUsage calls, the withAiUsageContext wrap at its two
 * queue entry points, and their imports). Everything else must be byte-identical to df0f6f5 (CRLF-normalized).
 * If this test fails, a staff bot change slipped in: revert it or get Rafael's explicit GO.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PINNED: Record<string, string> = {
  "src/app/api/bot/access-code/route.ts": "d0e8e39f7e77f215",
  "src/app/api/bot/telegram/connect/route.ts": "82b6f7f998281d2a",
  "src/app/api/bot/telegram/health/route.ts": "07c9ae0840597aa9",
  "src/app/api/bot/telegram/sessions/route.ts": "cc33b184c1f495c0",
  "src/app/api/bot/telegram/set-webhook/route.ts": "795faa678db4cea7",
  "src/app/api/bot/telegram/test-webhook/route.ts": "2fbf267c0c839bd5",
  "src/app/api/bot/telegram/webhook/route.ts": "343318a03d8f967b",
  "src/app/api/bot/whatsapp/webhook/route.ts": "93e5381a110fd2c7",
  "src/lib/bot/__tests__/grok-first-order.test.ts": "6df27484ec9428f8",
  "src/lib/bot/access-code.ts": "ebbb7114e348470e",
  "src/lib/bot/ai-agent.ts": "99a716e0ec6ebdf8",
  "src/lib/bot/ai-tools.ts": "ce6b140fdd176f2a",
  "src/lib/bot/bot-session.ts": "c6c0a852d2407fd9",
  "src/lib/bot/conversation-memory.ts": "6cc9b9178fe08be1",
  "src/lib/bot/guia-service.ts": "6aadc9296b8ddb51",
  "src/lib/bot/inbox.ts": "912cccbfde217894",
  "src/lib/bot/processor-registry.ts": "0491f5317ade2834",
  "src/lib/bot/telegram.ts": "8f9213d7979d1325",
  "src/lib/bot/whatsapp.ts": "89548513903c0d0e",
  "src/lib/bot/xai-responses.ts": "4650f7967d16d615"
}

const ALLOWED_LINE = /@\/lib\/ai-usage\/|recordAiUsage\(|withAiUsageContext\(/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p.split('\\').join('/'))
  }
  return out
}

function strippedHash(path: string): string {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  const kept = text.split('\n').filter((line) => !ALLOWED_LINE.test(line)).join('\n')
  return createHash('sha256').update(kept).digest('hex').slice(0, 16)
}

describe('staff bot boundary', () => {
  it('no staff bot file was added or removed', () => {
    const files = [...walk('src/lib/bot'), ...walk('src/app/api/bot')].sort()
    assert.deepEqual(files, Object.keys(PINNED).sort())
  })

  it('every staff bot file is unchanged except the approved usage-recording lines', () => {
    for (const [file, hash] of Object.entries(PINNED)) {
      assert.equal(strippedHash(file), hash, `${file} changed beyond the approved usage-recording lines`)
    }
  })

  it('the approved lines only record usage (no behavior): calls are fire-and-forget', () => {
    const record = readFileSync('src/lib/ai-usage/record.ts', 'utf8')
    assert.match(record, /export function recordAiUsage\(input: AiUsageEventInput\): void \{\s*try \{\s*void write\(input\)\.catch\(\(\) => \{\}\)/)
    for (const f of ['src/app/api/bot/telegram/webhook/route.ts', 'src/app/api/bot/whatsapp/webhook/route.ts']) {
      const src = readFileSync(f, 'utf8')
      // the original registration stays; the wrapped one re-registers the same processor inside a usage scope
      assert.match(src, /withAiUsageContext\(\{ tenantId: operation\.tenantId, feature: 'staff_bot' \}, \(\) => processQueued\w+Payload\(payload, operation\)\)/)
    }
  })

  it('the meter never imports the staff bot or the inbox agent', () => {
    for (const f of walk('src/lib/ai-usage')) {
      const src = readFileSync(f, 'utf8')
      assert.doesNotMatch(src, /@\/lib\/bot\/|@\/lib\/soft-ai\//, f)
    }
  })
})
