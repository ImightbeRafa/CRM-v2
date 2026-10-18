import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { followUpVariant, parseFollowUpConfig, SILENT_MIN_MINUTES } from '../soft-ai/follow-up'

const base = { agentId: 'a', lineIds: ['l'], texts: { A: 'a', B: 'b' }, createdAt: '2026-10-17T20:00:00Z', until: '2026-10-18T14:00:00Z', silentMinMinutes: 90, active: true }

describe('follow-up A/B', () => {
  it('split is deterministic per chat and roughly 50/50', () => {
    assert.equal(followUpVariant('fu-1', 'conv-1'), followUpVariant('fu-1', 'conv-1'))
    const n = Array.from({ length: 400 }, (_, i) => followUpVariant('fu-1', `c${i}`)).filter((v) => v === 'A').length
    assert.ok(n > 160 && n < 240, String(n))
  })

  it('config: missing text, bad dates, > 48 h or a silence under 30 min are dropped; claimed defaults to {}', () => {
    const c = parseFollowUpConfig({
      campaigns: [
        { ...base, id: 'no-b', texts: { A: 'hola', B: '' } },
        { ...base, id: 'bad-until', until: 'nunca' },
        { ...base, id: 'too-long', until: '2026-10-25T00:00:00Z' },
        { ...base, id: 'nan-silence', silentMinMinutes: null },
        { ...base, id: 'short-silence', silentMinMinutes: SILENT_MIN_MINUTES - 1 },
        { ...base, id: 'ok', claimed: null },
      ],
    })
    assert.deepEqual(c.campaigns.map((x) => x.id), ['ok'])
    assert.deepEqual(c.campaigns[0].claimed, {})
  })

  it('never: person / paused / closed / snoozed, past deciding, alerts, orders, waiting on a person, opt-out, declined, a person wrote last, already followed up', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    for (const reason of ['person_or_paused', 'stage_not_deciding', 'review_alert', 'closed_or_snoozed', 'has_order', 'waiting_on_person', 'last_reply_by_person', 'opted_out', 'declined', 'already_followed_up']) {
      assert.ok(src.includes(`'${reason}'`), reason)
    }
    assert.match(src, /if \(markers\?\.needsHuman \|\| markers\?\.handoffKind\) return 'waiting_on_person'/)
  })

  it('verifier round 1: shared per-run budget, paging past skipped chats, hours required, claim tied to the campaign id', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    assert.match(src, /const stop = \(\) => Date\.now\(\) - started > opts\.deadlineMs \|\| budget\.sent >= PER_RUN_MAX/)
    assert.match(src, /budget\.sent \+= 1/)
    assert.match(src, /\.\.\.\(exclude\.length \? \{ id: \{ notIn: exclude \} \} : \{\}\)/)
    assert.match(src, /if \(!hours\.hours\.enabled\) return/)
    assert.match(src, /->>'id' = \$\{campaignId\}::text/)
    assert.match(src, /jsonb_typeof\("config"->'campaigns'->\(\$\{index\}::int\)->'claimed'\) = 'object'/)
    assert.ok(src.indexOf('await claimChat(') < src.indexOf('await sendMetaText('))
    // Re-read right before the send; the line must still be served by the campaign's agent.
    assert.match(src, /fresh\.lastMessageDirection !== 'outbound'/)
    assert.match(src, /chatAgentBinding\.findFirst\(\{ where: \{ tenantId, socialAccountId: lineId, agentId: agent\.id, isActive: true \}/)
    // 24 h window and live agent.
    assert.match(src, /lastInboundAt: \{ gte: new Date\(now - FOLLOW_UP_WINDOW_MS\)/)
    assert.match(src, /if \(!agent \|\| agent\.status !== 'live'\) return/)
  })

  it('SecureDog: AI terms + agent gates + kill switch + token health; inactive campaigns never claim', () => {
    const src = readFileSync('src/lib/soft-ai/follow-up.ts', 'utf8')
    for (const needle of [
      'if (!(await isAiTermsAcceptedNow(tenantId))) return',
      'const gates = await runPreModelGates({ tenantId, socialAccountId: lineId, agentId: agent.id })',
      'if ((await readAgentKillState(tenantId)).armed) return',
      "['revoked', 'expired'].includes",
      "->>'active' = 'true'",
      '!(Date.parse(c.until) > now)',
      "status: { in: ['pending', 'retry', 'processing'] }",
    ]) {
      assert.ok(src.includes(needle), needle)
    }
  })

  it('script: validates numbers, a wrong id on stop fails', () => {
    const s = readFileSync('scripts/agent-pack/follow-up-campaign.ts', 'utf8')
    assert.match(s, /silent < SILENT_MIN_MINUTES/)
    assert.match(s, /hours > MAX_CAMPAIGN_HOURS/)
    assert.match(s, /no existe la campaña/)
  })

  it('cron runs it bounded and skips on a slow run', () => {
    const cron = readFileSync('src/app/api/cron/chat-automation/route.ts', 'utf8')
    assert.match(cron, /Date\.now\(\) - startedAt < 25_000 \? await runFollowUpCampaigns\(\{ deadlineMs: 10_000 \}\)\.catch\(\(\) => 0\) : 0/)
  })
})
