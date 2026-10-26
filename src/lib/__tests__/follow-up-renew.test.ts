/**
 * Rafael 2026-10-25 — follow-ups never silently stop: a live agent's newest round that ran out on its own is reopened
 * by the cron (same texts / keys / lines / wait, fresh claims). Stopped rounds, draft agents, line clashes, old or
 * key-less rounds and malformed rounds are left alone; a round whose text broke the opt-out guard is stopped instead.
 * Pure + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MAX_CAMPAIGN_HOURS, OPT_OUT_GUARD, parseFollowUpConfig, renewalChain, renewExpiredCampaigns, RENEW_MAX_AGE_MS } from '../soft-ai/follow-up'
import { WINNER_RULE } from '../../../scripts/agent-pack/follow-up-rule'

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
const LIVE = new Set(['forge', 'patch', 'other'])

describe('renewExpiredCampaigns', () => {
  it('reopens an expired round of a live agent: same texts / keys / lines / wait, fresh claims, old one marked', () => {
    const raw = [round('old', 'forge', NOW - 49 * H)]
    const r = renewExpiredCampaigns(raw, NOW, LIVE, newId)
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
    assert.deepEqual(r.outcomes.map((o) => o.why), ['renewed'])
    // The engine accepts it (indexes of the old rounds never move: only appended).
    assert.equal(parseFollowUpConfig({ campaigns: r.campaigns }).campaigns.filter((c) => c.active).length, 1)
    // A second pass changes nothing (no double renewal).
    assert.equal(renewExpiredCampaigns(r.campaigns, NOW, LIVE, newId), null)
  })

  it('leaves alone: running, stopped by hand, draft agent, malformed, no keys, ended too long ago', () => {
    assert.equal(renewExpiredCampaigns([round('run', 'forge', NOW - 10 * H)], NOW, LIVE, newId), null)
    assert.equal(renewExpiredCampaigns([round('stop', 'forge', NOW - 49 * H, { active: false, stoppedAt: 'x' })], NOW, LIVE, newId), null)
    assert.equal(renewExpiredCampaigns([round('stop2', 'forge', NOW - 49 * H, { stoppedAt: 'x' })], NOW, LIVE, newId), null)
    assert.equal(renewExpiredCampaigns([round('draft', 'deepclean', NOW - 49 * H)], NOW, LIVE, newId), null)
    assert.equal(renewExpiredCampaigns([round('bad', 'forge', NOW - 49 * H, { texts: { A: '', B: 'x' } })], NOW, LIVE, newId), null)
    assert.equal(renewExpiredCampaigns([round('nokeys', 'forge', NOW - 49 * H, { keys: undefined })], NOW, LIVE, newId), null)
    assert.equal(renewExpiredCampaigns([round('old', 'forge', NOW - 48 * H - RENEW_MAX_AGE_MS - H)], NOW, LIVE, newId), null)
  })

  it('a malformed entry never pins an agent: the newest VALID round renews', () => {
    const raw = [{ id: 'junk', agentId: 'forge', createdAt: 'nope' }, round('ok', 'forge', NOW - 49 * H)]
    assert.equal(renewExpiredCampaigns(raw, NOW, LIVE, newId)?.outcomes[0].from, 'ok')
  })

  it('only the NEWEST round per agent counts (an older expired one never comes back)', () => {
    assert.equal(renewExpiredCampaigns([round('older', 'forge', NOW - 100 * H), round('newer', 'forge', NOW - 10 * H)], NOW, LIVE, newId), null)
  })

  it('another agent running on one of the lines wins; several agents renew in one pass', () => {
    const clash = [round('a', 'forge', NOW - 49 * H), { ...round('b', 'other', NOW - 5 * H), lineIds: ['forge-wa'] }]
    assert.equal(renewExpiredCampaigns(clash, NOW, LIVE, newId), null)
    const r = renewExpiredCampaigns([round('f', 'forge', NOW - 49 * H), round('p', 'patch', NOW - 50 * H)], NOW, LIVE, newId)
    assert.equal(r?.outcomes.length, 2)
  })

  it('opt-out guard: a round whose text made people ask to stop is stopped, not renewed', () => {
    const r = renewExpiredCampaigns([round('bad', 'forge', NOW - 49 * H)], NOW, LIVE, newId, new Set(['bad']))
    assert.ok(r)
    assert.equal(r.campaigns.length, 1)
    assert.equal((r.campaigns[0] as Record<string, unknown>).stopReason, 'opt_out_guard')
    assert.equal((r.campaigns[0] as Record<string, unknown>).active, false)
    assert.deepEqual(r.outcomes, [{ from: 'bad', to: null, agentId: 'forge', why: 'opt_out_guard' }])
    // Same limits as the --rotate winner rule.
    assert.equal(OPT_OUT_GUARD.minCount, WINNER_RULE.optOutMinCount)
    assert.equal(OPT_OUT_GUARD.maxRate, WINNER_RULE.optOutMaxRate)
  })

  it('the cron renews before sending (one flags read, re-read only on change), under the row lock, audited; one nudge ever', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/soft-ai/follow-up.ts'), 'utf8')
    assert.match(src, /let flags = await readFlags\(\)\n\s+if \(await renewFollowUpCampaigns\(flags, now\)\) flags = await readFlags\(\)/)
    assert.match(src, /FOR UPDATE`/)
    assert.match(src, /Follow-up A\/B renovado automáticamente/)
    assert.match(src, /Follow-up A\/B DETENIDO por bajas/)
    assert.match(src, /if \(await followedUpBefore\(tenantId, conv\.id\)\) return 'already_followed_up'/)
    assert.match(src, /"metadata" \? 'followUp'/)
    const script = readFileSync(path.join(process.cwd(), 'scripts/agent-pack/follow-up-campaign.ts'), 'utf8')
    assert.match(script, /chain\.has\(c\.renewedFrom\)/)
    // The chain is rebuilt from the locked array (a renewal between read and write is stopped too).
    assert.match(script, /const locked = chainOf\(raw\)/)
  })
})

describe('renewalChain (opt-out guard pool)', () => {
  it('pools the round with the rounds it was renewed from (same texts), within 30 days, newest first', () => {
    const a = round('a', 'forge', NOW - 200 * H)
    const b = round('b', 'forge', NOW - 100 * H, { renewedFrom: 'a' })
    const c = round('c', 'forge', NOW - 50 * H, { renewedFrom: 'b' })
    const other = round('x', 'forge', NOW - 60 * H)
    assert.deepEqual(renewalChain([a, b, c, other], c, NOW).map((r) => r.id), ['c', 'b', 'a'])
    const old = round('old', 'forge', NOW - 40 * 24 * H)
    const next = round('n', 'forge', NOW - 50 * H, { renewedFrom: 'old' })
    assert.deepEqual(renewalChain([old, next], next, NOW).map((r) => r.id), ['n'])
    // A loop never hangs.
    const l1 = round('l1', 'forge', NOW - 50 * H, { renewedFrom: 'l2' })
    const l2 = round('l2', 'forge', NOW - 60 * H, { renewedFrom: 'l1' })
    assert.deepEqual(renewalChain([l1, l2], l1, NOW).map((r) => r.id), ['l1', 'l2'])
  })
})
