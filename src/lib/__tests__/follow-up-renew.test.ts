/**
 * Rafael 2026-10-25 — follow-ups never silently stop: a live agent's newest round that ran out on its own is reopened
 * by the cron (same texts / keys / lines / wait, fresh claims). Stopped rounds, draft agents, line clashes and
 * malformed rounds are left alone. Pure + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MAX_CAMPAIGN_HOURS, parseFollowUpConfig, renewExpiredCampaigns } from '../soft-ai/follow-up'

const NOW = Date.parse('2026-10-28T03:00:00Z')
const H = 3600_000
const round = (id: string, agentId: string, created: number, extra: Record<string, unknown> = {}) => ({
  id,
  agentId,
  lineIds: [`${agentId}-wa`, `${agentId}-ig`],
  texts: { A: 'texto A', B: 'texto B' },
  keys: { A: 'duda', B: 'cual' },
  createdAt: new Date(created).toISOString(),
  until: new Date(created + 48 * H).toISOString(),
  silentMinMinutes: 120,
  active: true,
  claimed: { conv1: 'A', conv2: 'B' },
  ...extra,
})
let n = 0
const newId = () => `fu-new-${++n}`

describe('renewExpiredCampaigns', () => {
  it('reopens an expired round of a live agent: same texts / keys / lines / wait, fresh claims, old one marked', () => {
    const raw = [round('old', 'forge', NOW - 49 * H)]
    const r = renewExpiredCampaigns(raw, NOW, new Set(['forge']), newId)
    assert.ok(r)
    assert.equal(r.campaigns.length, 2)
    assert.deepEqual(r.campaigns[0], { ...raw[0], active: false, stoppedAt: new Date(NOW).toISOString(), stopReason: 'auto_renew' })
    const fresh = r.campaigns[1] as Record<string, unknown>
    assert.equal(fresh.active, true)
    assert.deepEqual(fresh.claimed, {})
    assert.deepEqual(fresh.texts, raw[0].texts)
    assert.deepEqual(fresh.keys, raw[0].keys)
    assert.deepEqual(fresh.lineIds, raw[0].lineIds)
    assert.equal(fresh.silentMinMinutes, 120)
    assert.equal(fresh.renewedFrom, 'old')
    assert.equal(Date.parse(String(fresh.until)) - NOW, MAX_CAMPAIGN_HOURS * H)
    // The engine accepts it (indexes of the old rounds never move: only appended).
    assert.equal(parseFollowUpConfig({ campaigns: r.campaigns }).campaigns.filter((c) => c.active).length, 1)
  })

  it('leaves alone: a running round, a round stopped by hand, a draft agent, a malformed round', () => {
    assert.equal(renewExpiredCampaigns([round('run', 'forge', NOW - 10 * H)], NOW, new Set(['forge']), newId), null)
    assert.equal(renewExpiredCampaigns([round('stop', 'forge', NOW - 49 * H, { active: false, stoppedAt: 'x' })], NOW, new Set(['forge']), newId), null)
    assert.equal(renewExpiredCampaigns([round('stop2', 'forge', NOW - 49 * H, { stoppedAt: 'x' })], NOW, new Set(['forge']), newId), null)
    assert.equal(renewExpiredCampaigns([round('draft', 'deepclean', NOW - 49 * H)], NOW, new Set(['forge']), newId), null)
    assert.equal(renewExpiredCampaigns([round('bad', 'forge', NOW - 49 * H, { texts: { A: '', B: 'x' } })], NOW, new Set(['forge']), newId), null)
  })

  it('only the NEWEST round per agent counts (an older expired one never comes back)', () => {
    const raw = [round('older', 'forge', NOW - 100 * H), round('newer', 'forge', NOW - 10 * H)]
    assert.equal(renewExpiredCampaigns(raw, NOW, new Set(['forge']), newId), null)
  })

  it('another agent running on one of the lines wins; several agents renew in one pass', () => {
    const clash = [round('a', 'forge', NOW - 49 * H), { ...round('b', 'other', NOW - 5 * H), lineIds: ['forge-wa'] }]
    assert.equal(renewExpiredCampaigns(clash, NOW, new Set(['forge', 'other']), newId), null)
    const two = [round('f', 'forge', NOW - 49 * H), round('p', 'patch', NOW - 50 * H)]
    const r = renewExpiredCampaigns(two, NOW, new Set(['forge', 'patch']), newId)
    assert.equal(r?.renewed.length, 2)
  })

  it('the cron renews before sending, under the flag row lock, with an audit row', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/soft-ai/follow-up.ts'), 'utf8')
    assert.match(src, /await renewFollowUpCampaigns\(now\)\n\s+const flags/)
    assert.match(src, /FOR UPDATE`/)
    assert.match(src, /Follow-up A\/B renovado automáticamente/)
  })
})
