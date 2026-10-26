/**
 * Rafael 2026-10-25 — after hours the agent sells exactly like by day. A model escalation / "no lo tengo" at night keeps
 * the agent's answer and the chat on the agent (a quiet review for the team); payments, refunds, orders and "quiero una
 * persona" stay true hand-offs. Pure + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterHoursPromptLine, applyAfterHoursText, hasCheckPromise, IN_HOURS, nightKeepsSelling, type AfterHoursState } from '../soft-ai/business-hours'

const SAFE = 'Dame un momento y te confirmo 😊'
const NIGHT: AfterHoursState = { afterHours: true, opensAt: new Date('2026-10-26T12:00:00Z'), label: 'mañana a las 6:00 a. m.', note: null, transparent: true }
const OPTS = { safeReview: SAFE }
const plan = (text: string, reason: string, kind: 'handoff' | 'review' = 'handoff') => ({ text, handoff: { kind, reason } })

describe('nightKeepsSelling', () => {
  it('Forge 2026-10-25: a size-guide answer with escalate goes out as written, the chat stays on the agent', () => {
    const p = plan('Te dejo la guía de tallas 👇 Elegí según tu estatura y peso.', 'escalate')
    const r = nightKeepsSelling(p, NIGHT, SAFE)
    assert.equal(r.plan.handoff, null)
    assert.deepEqual(r.review, { kind: 'review', reason: 'escalate' })
    assert.equal(r.plan.text, p.text)
    // applyAfterHoursText no longer swaps it for "El equipo te escribe mañana".
    assert.equal(applyAfterHoursText(r.plan, NIGHT, OPTS), p.text)
  })

  it('a reply that promises a check gets "El equipo te escribe <label>" once', () => {
    const r = nightKeepsSelling(plan('No sé si entregan en la terminal; voy a confirmarlo y te cuento 😊', 'escalate'), NIGHT, SAFE)
    assert.match(r.plan.text, /voy a confirmarlo y te cuento 😊\nEl equipo te escribe mañana a las 6:00 a\. m\.$/)
    const already = nightKeepsSelling(plan('Lo confirmo y el equipo te escribe mañana a las 6:00 a. m.', 'escalate'), NIGHT, SAFE)
    assert.equal(already.plan.text, 'Lo confirmo y el equipo te escribe mañana a las 6:00 a. m.')
  })

  it('"no lo tengo" (unknown_answer) keeps what it knew and says when the team writes', () => {
    const r = nightKeepsSelling(plan('Cuesta ₡14 900. Ese dato no lo tengo acá.', 'unknown_answer'), NIGHT, SAFE)
    assert.equal(r.plan.handoff, null)
    assert.equal(r.plan.text, 'Cuesta ₡14 900. Ese dato no lo tengo acá.\nEl equipo te escribe mañana a las 6:00 a. m.')
  })

  it('payments, refunds, orders, opt-out and the safe line keep the true hand-off', () => {
    for (const reason of ['payment', 'complaint', 'order_ready', 'order_ready_cash', 'human_request', 'payment_details']) {
      const p = plan('¡Gracias! 🙌', reason)
      assert.equal(nightKeepsSelling(p, NIGHT, SAFE).plan, p, reason)
      assert.equal(nightKeepsSelling(p, NIGHT, SAFE).review, null, reason)
    }
    const safe = plan(SAFE, 'escalate')
    assert.equal(nightKeepsSelling(safe, NIGHT, SAFE).plan, safe)
  })

  it('in hours nothing changes', () => {
    const p = plan('Te dejo la guía de tallas 👇', 'escalate')
    assert.equal(nightKeepsSelling(p, IN_HOURS, SAFE).plan, p)
  })

  it('check-promise detector', () => {
    for (const t of ['lo confirmo', 'Voy a revisar', 'déjame consultar', 'te cuento', 'Dame un momento']) assert.ok(hasCheckPromise(t), t)
    for (const t of ['Te dejo la guía de tallas', 'El arnés cuesta ₡14 900', 'Consultá con tu médico']) assert.ok(!hasCheckPromise(t), t)
  })

  it('the night prompt line says the agent keeps selling like by day', () => {
    assert.match(afterHoursPromptLine(NIGHT) || '', /seguís atendiendo y vendiendo igual que de día/)
  })

  it('live turn and Probar both run it; the live review keeps images (escalate off) and alerts the team', () => {
    const turn = readFileSync(path.join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.equal(turn.match(/nightKeepsSelling\(/g)?.length, 2)
    assert.match(turn, /burstReview: burstReview \?\? night\.review,/)
    assert.match(turn, /escalate: night\.review \? false : llm\.escalate,/)
  })
})
