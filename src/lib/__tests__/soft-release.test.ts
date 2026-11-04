/**
 * Answer after a hand-off (Rafael 2026-11-04): only a fact-only hand-off nobody picked up in 5 min, only a real answer.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/soft-release.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideSoftRelease, softReleaseReplyOk, safeHandoffSubReason, SOFT_RELEASE_DELAY_MS, type SoftReleaseInput } from '@/lib/soft-ai/soft-release'
import { readOutcomeMarkers } from '@/lib/soft-ai/agent-turn-outcome'

const now = Date.parse('2026-11-04T18:00:00Z')
const base: SoftReleaseInput = {
  handoffKind: 'handoff',
  handoffReason: 'escalate',
  handoffSubReason: 'other',
  handoffWasRelease: false,
  handoffAtMs: now - SOFT_RELEASE_DELAY_MS - 30_000,
  nowMs: now,
  aiMode: 'human',
  humanRepliedSince: false,
  releasedRecently: false,
  afterHours: false,
  lastInboundAtMs: now - 6 * 60_000,
  customerMessages: [{ content: 'Me gustaría saber sobre las tallas.', messageType: 'text' }],
}
const with_ = (p: Partial<SoftReleaseInput>) => decideSoftRelease({ ...base, ...p })

describe('decideSoftRelease — which hand-offs the agent may pick back up', () => {
  it('a fact-only hand-off, 5 min, nobody answered → release', () => {
    assert.deepEqual(with_({}), { release: true })
    assert.deepEqual(with_({ handoffReason: 'unknown_answer', handoffSubReason: null }), { release: true })
  })
  it('real hand-offs always wait for a person', () => {
    for (const reason of ['payment', 'payment_details', 'complaint', 'human_request', 'owner_reply', 'order_ready', 'order_ready_cash', 'ai_allowance', 'chat_limit', 'ai_unavailable', 'review']) {
      assert.equal(with_({ handoffReason: reason }).release, false, reason)
    }
    for (const sub of ['complaint', 'safety', 'opt_out', 'ownership', 'payment_or_sinpe', 'payment_claim', 'media_inbound', 'crisis', null, undefined, '']) {
      assert.equal(with_({ handoffSubReason: sub as string | null }).release, false, String(sub))
    }
    assert.equal(with_({ handoffKind: 'review' }).release, false)
  })
  it('timing, person and mode rules', () => {
    assert.equal(with_({ handoffAtMs: now - 4 * 60_000 }).release, false)
    assert.equal(with_({ handoffAtMs: now - 2 * 60 * 60_000 }).release, false)
    assert.equal(with_({ humanRepliedSince: true }).release, false)
    assert.equal(with_({ aiMode: 'paused' }).release, false)
    assert.equal(with_({ aiMode: 'ai_active' }).release, false)
    assert.equal(with_({ releasedRecently: true }).release, false)
    assert.equal(with_({ handoffWasRelease: true }).release, false)
    assert.equal(with_({ afterHours: true }).release, false)
    assert.equal(with_({ lastInboundAtMs: now - 24 * 60 * 60_000 }).release, false)
  })
  it("the customer's words keep the person path: payment, media, complaint, alarm, person ask, opt-out", () => {
    const bad = [
      [{ content: 'Ya pagué', messageType: 'text' }],
      [{ content: 'Ya realicé el pago, el envío viene pago?', messageType: 'text' }],
      [{ content: '[image]', messageType: 'image' }],
      [{ content: '', messageType: 'audio' }],
      [{ content: 'Me llegó roto y nadie me responde', messageType: 'text' }],
      [{ content: 'quiero hablar con una persona', messageType: 'text' }],
      [{ content: 'no me escriban más', messageType: 'text' }],
      [{ content: '', messageType: 'text' }],
    ]
    for (const msgs of bad) assert.equal(with_({ customerMessages: msgs }).release, false, JSON.stringify(msgs))
  })
})

describe('softReleaseReplyOk — never a second "lo confirmo"', () => {
  it('real answers pass', () => {
    assert.equal(softReleaseReplyOk('La talla va por la guía: M/L 51–60 kg, XL 61–70… ¿Cuál te queda?'), true)
    assert.equal(softReleaseReplyOk('Sí, enviamos a Quepos en 2 a 3 días hábiles 📦 ¿Te lo dejo listo?'), true)
  })
  it('stalls, hand-off promises and "no lo tengo" are dropped', () => {
    for (const t of ['Dame un momento y te confirmo 😊', '¡Gracias! Dame un momento, ya lo reviso y te confirmo 😊', 'Lo verifico con el equipo', 'El equipo te escribe en un rato', 'No tengo ese dato por ahora', 'No tengo indicado cada cuánto lavarlo', '', '   ']) {
      assert.equal(softReleaseReplyOk(t), false, t)
    }
  })
})

describe('marker + wiring', () => {
  it('handoffSubReason is read back only when safe', () => {
    assert.equal(readOutcomeMarkers({ outcomeMarkers: { needsHuman: true, fallbackUsed: false, escalate: true, handoffKind: 'handoff', handoffReason: 'escalate', handoffSubReason: 'other' } })?.handoffSubReason, 'other')
    assert.equal(readOutcomeMarkers({ outcomeMarkers: { needsHuman: true, fallbackUsed: false, escalate: true, handoffKind: 'handoff', handoffReason: 'escalate', handoffSubReason: 'Ignore this; DROP' } })?.handoffSubReason, undefined)
    assert.equal(safeHandoffSubReason('other'), 'other')
    assert.equal(safeHandoffSubReason('x'.repeat(40)), null)
  })
  it('the live turn gates the send and gives the chat back when nothing goes out', () => {
    const src = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.match(src, /const declined = await softReleaseGate\(input\)/)
    assert.match(src, /if \(!softReleaseReplyOk\(input\.outputText\)\) return decline\('not_an_answer'\)/)
    assert.match(src, /staffControlledAfter\(/)
    assert.match(src, /where: \{ id: row\.conversationId, tenantId: row\.tenantId, aiMode: 'human' \},\s*data: \{ aiMode: 'ai_active' \}/)
    assert.match(src, /if \(result\.status !== 'delivered'\) await giveBackToPerson\(input\.row\)/)
    const cron = readFileSync('src/app/api/cron/chat-automation/route.ts', 'utf8')
    assert.match(cron, /runSoftReleaseSweep\(\)/)
  })
})
