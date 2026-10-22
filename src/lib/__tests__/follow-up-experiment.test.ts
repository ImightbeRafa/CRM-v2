import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chanceBetter, decideWinner, WINNER_RULE, type ArmStats } from '../../../scripts/agent-pack/follow-up-rule'

const arm = (key: string, sent: number, replied: number, ordered: number, optedOut = 0, days = 8): ArmStats => ({ key, sent, replied, ordered, revenue: ordered * 12_900, optedOut, days })

describe('follow-up experiment winner rule (Lane E 2026-10-22)', () => {
  it('chanceBetter is deterministic and sensible', () => {
    assert.equal(chanceBetter({ n: 48, k: 10 }, { n: 50, k: 2 }), chanceBetter({ n: 48, k: 10 }, { n: 50, k: 2 }))
    // 2026-10-18 PatchHouse: "combo" (2/50 replies) vs "duda" (10/48) → combo almost surely replies less.
    assert.ok(chanceBetter({ n: 48, k: 10 }, { n: 50, k: 2 }) < 0.02)
    const even = chanceBetter({ n: 200, k: 40 }, { n: 200, k: 40 })
    assert.ok(even > 0.45 && even < 0.55, String(even))
  })

  it('no decision before the minimum sample and a full week', () => {
    assert.equal(decideWinner(arm('a', 100, 30, 8), arm('b', 100, 60, 20)).kind, 'keep_testing')
    assert.equal(decideWinner(arm('a', 300, 30, 8, 0, 3), arm('b', 300, 90, 30, 0, 3)).kind, 'keep_testing')
  })

  it('orders decide first when there are enough of them', () => {
    assert.equal(decideWinner(arm('a', 300, 60, 6), arm('b', 300, 60, 24)).kind, 'challenger_wins')
    assert.equal(decideWinner(arm('a', 300, 60, 24), arm('b', 300, 60, 6)).kind, 'champion_keeps')
    // More replies but clearly fewer orders → the challenger does not win on replies.
    assert.notEqual(decideWinner(arm('a', 300, 30, 24), arm('b', 300, 90, 8)).kind, 'challenger_wins')
  })

  it('few orders → replies decide, as long as orders are not clearly worse', () => {
    assert.equal(decideWinner(arm('a', 200, 20, 2), arm('b', 200, 60, 3)).kind, 'challenger_wins')
    assert.equal(decideWinner(arm('a', 200, 60, 3), arm('b', 200, 20, 2)).kind, 'champion_keeps')
  })

  it('verifier F2: with 10+ orders a reply win needs at least even odds on orders', () => {
    // 8 vs 5 orders (13): the challenger is ~79 % likely to sell less → must not win on replies.
    assert.notEqual(decideWinner(arm('a', 300, 30, 8), arm('b', 300, 60, 5)).kind, 'challenger_wins')
  })

  it('opt-out guardrail beats everything; a bad champion stops the agent', () => {
    assert.equal(decideWinner(arm('a', 200, 20, 2), arm('b', 200, 80, 9, 8)).kind, 'challenger_dropped')
    assert.equal(decideWinner(arm('a', 200, 20, 2, 9), arm('b', 200, 20, 2)).kind, 'stop_agent')
    // Under the minimum count, no guardrail yet.
    assert.notEqual(decideWinner(arm('a', 40, 4, 0), arm('b', 40, 4, 0, WINNER_RULE.optOutMinCount - 1)).kind, 'challenger_dropped')
  })

  it('no clear difference after the maximum → the champion stays', () => {
    assert.equal(decideWinner(arm('a', 600, 120, 6), arm('b', 600, 122, 6)).kind, 'champion_keeps')
  })

  it('script: dry-run on every write, stops only the same agent, never drops a claim', () => {
    const s = readFileSync('scripts/agent-pack/follow-up-campaign.ts', 'utf8')
    assert.match(s, /const DRY = flag\('dry-run'\)/)
    assert.equal((s.match(/if \(DRY\) return/g) || []).length, 2)
    assert.match(s, /stopWhere\(\(c\) => c\.agentId === agentId\)/)
    assert.match(s, /de otro agente usa una de estas líneas/)
    // Verifier F1/F3/F5/F6: only hard opt-outs feed the rule; writes under FOR UPDATE on the raw array; no silent re-enable.
    assert.match(s, /if \(after\.some\(\(m\) => isOptOutText\(m\.content\)\)\) s\.optedOut\+\+/)
    assert.match(s, /FOR UPDATE/)
    assert.doesNotMatch(s, /data: \{ enabled: true, config/)
    assert.match(s, /--enable lo enciende/)
    assert.match(s, /no se inicia/)
    assert.match(s, /se inicia cuando Rafael lo active/)
  })
})
