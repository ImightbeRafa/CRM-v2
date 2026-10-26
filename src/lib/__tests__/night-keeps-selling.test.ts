/**
 * Rafael 2026-10-25 — after hours the agent sells exactly like by day. A model escalation / "no lo tengo" at night keeps
 * the agent's answer and the chat on the agent (a quiet review for the team); payments, refunds, orders, complaints,
 * health alarms and "quiero una persona" stay true hand-offs. Pure + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  afterHoursPromptLine,
  afterHoursReviewLine,
  applyAfterHoursText,
  customerNeedsPersonAtNight,
  hasCheckPromise,
  IN_HOURS,
  nightKeepsSelling,
  type AfterHoursState,
} from '../soft-ai/business-hours'
import { admitsCannotAnswer, applySafeLineCap, SAFE_LINE } from '../soft-ai/agent-turn-outcome'

const SAFE = SAFE_LINE.review
const NIGHT: AfterHoursState = { afterHours: true, opensAt: new Date('2026-10-26T12:00:00Z'), label: 'mañana a las 6:00 a. m.', note: null, transparent: true }
const OPTS = { safeReview: SAFE }
const plan = (text: string, reason: string, kind: 'handoff' | 'review' = 'handoff') => ({ text, handoff: { kind, reason } })
const run = (text: string, reason: string, customerText = '¿Cómo se lava?') =>
  nightKeepsSelling(plan(text, reason), NIGHT, { safeReview: SAFE, customerText, cannotAnswer: admitsCannotAnswer })

describe('nightKeepsSelling', () => {
  it('Forge 2026-10-25: a size-guide answer with escalate goes out as written, the chat stays on the agent', () => {
    const text = 'Te dejo la guía de tallas 👇 Elegí según tu estatura y peso.'
    const r = run(text, 'escalate', 'Y si mido 1.90?')
    assert.equal(r.plan.handoff, null)
    assert.deepEqual(r.review, { kind: 'review', reason: 'escalate' })
    assert.equal(r.plan.text, text)
    assert.equal(applyAfterHoursText(r.plan, NIGHT, OPTS), text)
  })

  it('a reply that promises a later check gets "El equipo te escribe <label>" once', () => {
    assert.match(run('No sé si entregan en la terminal; lo averiguo y te escribo 😊', 'escalate').plan.text, /\nEl equipo te escribe mañana a las 6:00 a\. m\.$/)
    const already = run('Lo confirmo y el equipo te escribe mañana a las 6:00 a. m.', 'escalate')
    assert.equal(already.plan.text, 'Lo confirmo y el equipo te escribe mañana a las 6:00 a. m.')
  })

  it('Verifier #2: a "right now" promise becomes the after-hours review line (never "Dame un momento" + "mañana")', () => {
    for (const t of ['Dame un momento y lo confirmo 😊', 'Enseguida te confirmo si hay entrega en Pérez Zeledón 😊']) {
      const r = run(t, 'escalate')
      assert.equal(r.review, null, t)
      assert.deepEqual(r.plan.handoff, { kind: 'review', reason: 'escalate' }, t)
      assert.equal(applyAfterHoursText(r.plan, NIGHT, OPTS), afterHoursReviewLine(NIGHT.label, true), t)
    }
  })

  it('Verifier #5: the safe line at night is a review (chat stays on the agent); a repeat still becomes a hand-off', () => {
    const r = run(SAFE, 'escalate')
    assert.deepEqual(r.plan.handoff, { kind: 'review', reason: 'escalate' })
    assert.equal(applySafeLineCap(r.plan, false).handoff?.kind, 'review')
    const capped = applySafeLineCap(r.plan, true)
    assert.equal(capped.handoff?.kind, 'handoff')
    assert.equal(capped.suppressSend, true)
  })

  it('"no lo tengo" (unknown_answer) keeps what it knew and says when the team writes', () => {
    const r = run('Cuesta ₡14 900. Ese dato no lo tengo acá.', 'unknown_answer')
    assert.equal(r.plan.handoff, null)
    assert.equal(r.plan.text, 'Cuesta ₡14 900. Ese dato no lo tengo acá.\nEl equipo te escribe mañana a las 6:00 a. m.')
  })

  it('Verifier #1: a complaint, a health alarm or a person request keeps the true hand-off at night', () => {
    for (const c of [
      'Me llegó el pedido y vino roto 😡',
      'Pésimo servicio, hace 10 días pedí y nada',
      'El parche me dio una reacción en la piel',
      'Mi hijo se tragó un parche',
      'pásame con la dueña',
      'quiero hablar con una persona',
    ]) {
      assert.ok(customerNeedsPersonAtNight(c), c)
      const p = plan('Lamento mucho lo que pasó 🙏', 'escalate')
      assert.equal(nightKeepsSelling(p, NIGHT, { safeReview: SAFE, customerText: c }).plan, p, c)
    }
    for (const c of ['¿Cómo se lava?', 'Y si mido 1.90?', '¿Es bueno para el dolor de espalda?', '¿Puedo personalizarlo?']) assert.ok(!customerNeedsPersonAtNight(c), c)
  })

  it('payments, refunds, orders and opt-out keep the true hand-off; in hours nothing changes', () => {
    for (const reason of ['payment', 'complaint', 'order_ready', 'order_ready_cash', 'human_request', 'payment_details']) {
      const p = plan('¡Gracias! 🙌', reason)
      assert.equal(nightKeepsSelling(p, NIGHT, OPTS).plan, p, reason)
    }
    const p = plan('Te dejo la guía de tallas 👇', 'escalate')
    assert.equal(nightKeepsSelling(p, IN_HOURS, OPTS).plan, p)
  })

  it('Verifier #4: check-promise detector is first person only', () => {
    for (const t of ['lo confirmo', 'Voy a revisar', 'Déjeme confirmarlo', 'Permitime revisarlo', 'Le confirmo apenas sepa', 'Te escribo apenas lo sepa', 'Lo chequeo', 'Un momentito', 'lo averiguo']) {
      assert.ok(hasCheckPromise(t), t)
    }
    for (const t of ['Te cuento que sí tenemos envíos', 'lo consultás con tu médico', 'Lo revisás en la guía de tallas', 'Te aviso que el envío sale ₡2 500', 'Te dejo la guía de tallas']) {
      assert.ok(!hasCheckPromise(t), t)
    }
  })

  it('the night prompt line says the agent keeps selling like by day', () => {
    assert.match(afterHoursPromptLine(NIGHT) || '', /seguís atendiendo y vendiendo igual que de día/)
  })

  it('live turn and Probar both run it with the customer text; live and Probar drop escalate / needsHuman on a review', () => {
    const turn = readFileSync(path.join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
    assert.equal(turn.match(/nightKeepsSelling\(/g)?.length, 2)
    assert.match(turn, /const modelPlan = applySafeLineCap\(night\.plan,/)
    assert.match(turn, /burstReview: burstReview \?\? night\.review,/)
    assert.match(turn, /escalate: night\.review \? false : llm\.escalate,/)
    assert.match(turn, /escalate = night\.review \? false : llm\.escalate/)
    assert.match(turn, /needsHuman = night\.review \? false :/)
  })
})
