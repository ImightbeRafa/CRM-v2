import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHAT_STREAM_MAX_PER_TENANT,
  chatSseEnabled,
  chatStreamStats,
  setChatStreamRevisionReader,
  subscribeChatTicks,
} from '@/lib/chat-stream-hub'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const saved = process.env.CHAT_SSE
afterEach(() => {
  if (saved === undefined) delete process.env.CHAT_SSE
  else process.env.CHAT_SSE = saved
  setChatStreamRevisionReader(null)
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('chat SSE hub', () => {
  it('is off by default and arms on 1/true/on', () => {
    delete process.env.CHAT_SSE
    assert.equal(chatSseEnabled(), false)
    for (const v of ['1', 'true', 'on']) {
      process.env.CHAT_SSE = v
      assert.equal(chatSseEnabled(), true)
    }
    process.env.CHAT_SSE = '0'
    assert.equal(chatSseEnabled(), false)
  })

  it('ticks only the tenant whose revision moved, with no data besides the revision', async () => {
    let revA = '10'
    setChatStreamRevisionReader(async (tenantId) => (tenantId === 'A' ? revA : '5'))
    const gotA: string[] = []
    const gotB: string[] = []
    const offA = subscribeChatTicks('A', (r) => gotA.push(r))
    const offB = subscribeChatTicks('B', (r) => gotB.push(r))
    assert.ok(offA && offB)
    await wait(30)
    revA = '11'
    await wait(2_300)
    assert.deepEqual(gotA, ['11'])
    assert.deepEqual(gotB, [])
    offA?.()
    offB?.()
  })

  it('cleans up: no listeners and no timers after the last unsubscribe', async () => {
    setChatStreamRevisionReader(async () => '1')
    const before = chatStreamStats()
    const off = subscribeChatTicks('T', () => {})
    assert.equal(chatStreamStats().tenants, before.tenants + 1)
    off?.()
    off?.() // idempotent
    assert.deepEqual(chatStreamStats(), before)
  })

  it('caps connections per tenant', () => {
    setChatStreamRevisionReader(async () => '1')
    const offs: Array<() => void> = []
    for (let i = 0; i < CHAT_STREAM_MAX_PER_TENANT; i += 1) {
      const off = subscribeChatTicks('CAP', () => {})
      assert.ok(off)
      offs.push(off!)
    }
    assert.equal(subscribeChatTicks('CAP', () => {}), null)
    const other = subscribeChatTicks('OTHER', () => {}) // another tenant is unaffected
    assert.ok(other)
    other?.()
    for (const off of offs) off()
  })
})

describe('chat SSE route and client (static)', () => {
  const route = read('src/app/api/chat/stream/route.ts')
  it('authenticates like /changes and scopes by the session tenant', () => {
    assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(route, /subscribeChatTicks\(auth\.tenantId/)
    assert.doesNotMatch(route, /searchParams\.get\('tenantId'\)/)
  })
  it('is off without CHAT_SSE, sends heartbeats and closes after 5 minutes', () => {
    assert.match(route, /chatSseEnabled\(\)/)
    assert.match(route, /status: 404/)
    assert.match(route, /HEARTBEAT_MS = 20_000/)
    assert.match(route, /MAX_LIFETIME_MS = 5 \* 60_000/)
    assert.match(route, /text\/event-stream/)
    assert.match(route, /no-transform/)
  })
  it('frames carry only the revision', () => {
    assert.match(route, /event: tick\\ndata: \$\{JSON\.stringify\(\{ revision \}\)\}/)
  })
  it('the inbox keeps polling: SSE only speeds it up and falls back on any error', () => {
    const client = read('src/components/chats/SoftCopilotInboxV2.tsx')
    assert.match(client, /\/api\/chat\/stream\?probe=1/)
    assert.match(client, /source\.onerror/)
    assert.match(client, /sseHealthyRef\.current = false/)
    assert.match(client, /window\.setInterval\(\(\) => tick\(\), CHAT_INBOX_V2_POLL_MS\)/)
  })
  it('CHAT_SSE reaches the container', () => {
    assert.match(read('src/cf-container-worker.ts'), /"CHAT_SSE"/)
  })
})

describe('SSE client robustness (review fixes)', () => {
  const client = read('src/components/chats/SoftCopilotInboxV2.tsx')
  it('a live tick that arrives during a running poll is re-run, not dropped', () => {
    assert.match(client, /if \(forced && decision\.reason === 'in_flight'\) pendingForcedRef\.current = true/)
    assert.match(client, /if \(pendingForcedRef\.current\) \{\s*pendingForcedRef\.current = false\s*tickRef\.current\?\.\(true\)/)
  })
  it('the safety timer only restarts when a poll really runs', () => {
    const body = client.slice(client.indexOf('const tick = (forced = false)'))
    assert.ok(body.indexOf("decision.action === 'skip'") < body.indexOf('lastPollAtRef.current = Date.now()'))
  })
  it('a live tick on a reconcile also fetches the thread changes', () => {
    assert.match(client, /if \(forced\) await fetchChanges\(\)/)
  })
  it('a silent stream is treated as broken (named ping + watchdog)', () => {
    assert.match(client, /addEventListener\('ping'/)
    assert.match(client, /CHAT_INBOX_V2_SSE_SILENT_MS/)
    assert.match(read('src/app/api/chat/stream/route.ts'), /event: ping/)
  })
})
