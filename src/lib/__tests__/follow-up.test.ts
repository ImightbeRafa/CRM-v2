import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { followUpVariant, parseFollowUpConfig } from '../soft-ai/follow-up'

describe('follow-up A/B', () => {
  it('split is deterministic per chat and roughly 50/50', () => {
    assert.equal(followUpVariant('fu-1', 'conv-1'), followUpVariant('fu-1', 'conv-1'))
    const n = Array.from({ length: 400 }, (_, i) => followUpVariant('fu-1', `c${i}`)).filter((v) => v === 'A').length
    assert.ok(n > 160 && n < 240, String(n))
  })

  it('config: campaigns without both texts are dropped; claimed defaults to {}', () => {
    const c = parseFollowUpConfig({ campaigns: [{ id: 'x', agentId: 'a', lineIds: ['l'], texts: { A: 'hola', B: '' } }, { id: 'y', agentId: 'a', lineIds: ['l'], texts: { A: 'a', B: 'b' } }] })
    assert.deepEqual(c.campaigns.map((x) => x.id), ['y'])
    assert.deepEqual(c.campaigns[0].claimed, {})
  })

  it('never: person / paused, review alerts, orders, opt-out, a person wrote last, already followed up', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    for (const reason of ['person_or_paused', 'review_alert', 'has_order', 'last_reply_by_person', 'opted_out', 'already_followed_up']) assert.ok(src.includes(`'${reason}'`), reason)
    // Business hours, 24 h window, line answering, live agent, atomic claim before the send.
    assert.match(src, /afterHoursState\(hours\.hours, new Date\(now\)/)
    assert.match(src, /lastInboundAt: \{ gte: new Date\(now - FOLLOW_UP_WINDOW_MS\)/)
    assert.match(src, /if \(!\(await lineAnswersNow\(tenantId, lineId\)\)\) continue/)
    assert.match(src, /if \(!agent \|\| agent\.status !== 'live'\) return 0/)
    assert.ok(src.indexOf('await claimChat(') < src.indexOf('await sendMetaText('))
    assert.match(src, /AND NOT \(COALESCE/)
  })

  it('cron runs it bounded and skips on a slow run', () => {
    const cron = readFileSync('src/app/api/cron/chat-automation/route.ts', 'utf8')
    assert.match(cron, /Date\.now\(\) - startedAt < 25_000 \? await runFollowUpCampaigns\(\{ deadlineMs: 10_000 \}\)\.catch\(\(\) => 0\) : 0/)
  })
})
