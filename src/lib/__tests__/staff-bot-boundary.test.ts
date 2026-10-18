/**
 * Staff bot boundary (Rafael, 2026-10-08): the staff bot (src/lib/bot/**, src/app/api/bot/**) is never changed,
 * with ONE approved exception — AI usage recording (recordAiUsage calls, the withAiUsageContext wrap at its two
 * queue entry points, and their imports). Everything else must be byte-identical to df0f6f5 (CRLF-normalized).
 * If this test fails, a staff bot change slipped in: revert it or get Rafael's explicit GO.
 *
 * Re-pinned 2026-10-17 (luna-10) with Rafael's explicit GO: "Yes, move the staff bot (Telegram/WhatsApp) to Luna too,
 * test it separately, and remove XAI completely." xAI client -> OpenAI gpt-6-luna (OPENAI_API_KEY), xai-responses.ts ->
 * ai-responses.ts, grok-first-order.test.ts -> staff-bot-first-order.test.ts, health check key.
 *
 * Re-pinned 2026-10-17 (luna-10) with Rafael's explicit GO: "Yes, move the staff bot (Telegram/WhatsApp) to Luna too,
 * test it separately, and remove XAI completely." xAI client -> OpenAI gpt-6-luna (OPENAI_API_KEY), xai-responses.ts ->
 * ai-responses.ts, grok-first-order.test.ts -> staff-bot-first-order.test.ts, health check key.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PINNED: Record<string, string> = {
  "src/app/api/bot/access-code/route.ts": "d0e8e39f7e77f215",
  "src/app/api/bot/telegram/connect/route.ts": "82b6f7f998281d2a",
  "src/app/api/bot/telegram/health/route.ts": "ffc5d97ddbf3c369",
  "src/app/api/bot/telegram/sessions/route.ts": "cc33b184c1f495c0",
  "src/app/api/bot/telegram/set-webhook/route.ts": "795faa678db4cea7",
  "src/app/api/bot/telegram/test-webhook/route.ts": "2fbf267c0c839bd5",
  "src/app/api/bot/telegram/webhook/route.ts": "343318a03d8f967b",
  "src/app/api/bot/whatsapp/webhook/route.ts": "93e5381a110fd2c7",
  "src/lib/bot/__tests__/staff-bot-first-order.test.ts": "85d481add63088e5",
  "src/lib/bot/access-code.ts": "ebbb7114e348470e",
  "src/lib/bot/ai-agent.ts": "7d10bda564b1ee40",
  "src/lib/bot/ai-responses.ts": "777af77a57b39c57",
  "src/lib/bot/ai-tools.ts": "ce6b140fdd176f2a",
  "src/lib/bot/bot-session.ts": "c6c0a852d2407fd9",
  "src/lib/bot/conversation-memory.ts": "6cc9b9178fe08be1",
  "src/lib/bot/guia-service.ts": "6aadc9296b8ddb51",
  "src/lib/bot/inbox.ts": "912cccbfde217894",
  "src/lib/bot/processor-registry.ts": "0491f5317ade2834",
  "src/lib/bot/telegram.ts": "8f9213d7979d1325",
  "src/lib/bot/whatsapp.ts": "89548513903c0d0e"
}

// Whole-line shapes only: an approved import, a single-line recordAiUsage({...}) call, or the processor re-registration.
const ALLOWED_LINE =
  /^(import \{[^}]+\} from '@\/lib\/ai-usage\/(record|rate-card|context)';?|\s*recordAiUsage\(\{[^;]*\}\);?|registerBotInboxProcessor\('(telegram|whatsapp)', \(payload, operation\) => withAiUsageContext\(\{ tenantId: operation\.tenantId, feature: 'staff_bot' \}, \(\) => processQueued(Telegram|WhatsApp)Payload\(payload, operation\)\)\);)$/

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

describe('staff bot probe (luna-10, SecureDog)', () => {
  it('no route or page imports the raw-provider probe — scripts only', () => {
    const hits = walk('src/app').filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(f, 'utf8').includes('__staffBotAiProbe'))
    assert.deepEqual(hits, [])
  })
})
