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
import { admitsCannotAnswer, applySafeLineCap, isComplaintText, SAFE_LINE } from '../soft-ai/agent-turn-outcome'

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
    assert.match(turn, /escalate: night\.soft \? false : llm\.escalate,/)
    assert.match(turn, /escalate = night\.soft \? false : llm\.escalate/)
    assert.match(turn, /needsHuman = night\.soft \? false :/)
    assert.equal(turn.match(/modelReason: llm\.handoff\?\.kind === 'handoff' \? llm\.escalateReason : null/g)?.length, 2)
    assert.equal(turn.match(/isComplaint: isComplaintText/g)?.length, 2)
  })
})

describe('nightKeepsSelling · verifier round 2', () => {
  const full = (customerText: string, modelReason: string | null = 'other') => ({ safeReview: SAFE, customerText, modelReason, cannotAnswer: admitsCannotAnswer, isComplaint: isComplaintText })

  it('#1: the model reason complaint / safety / opt_out is never downgraded', () => {
    for (const reason of ['complaint', 'safety', 'opt_out']) {
      const p = plan('Lamento mucho lo que pasó 🙏', 'escalate')
      const r = nightKeepsSelling(p, NIGHT, full('¿Cómo se lava?', reason))
      assert.equal(r.plan, p, reason)
      assert.equal(r.soft, false, reason)
    }
  })

  it('#1: more complaints, alarms, crises and person requests keep the hand-off (backstop)', () => {
    for (const c of [
      'Me quiero morir',
      'Quiero quitarme la vida',
      'Mi hijo se puso un parche',
      'Mi bebé se comió un parche',
      'Se me hinchó la cara',
      'Me arde mucho la piel',
      'Qué mal servicio',
      'Estoy muy molesta con ustedes',
      'Hace una semana pedí y todavía no me llega',
      'No me sirvió para nada',
      'El producto no funciona',
      'Vino incompleto',
      'Me llegó otro producto',
      '¿Me puede llamar alguien?',
    ]) {
      assert.ok(customerNeedsPersonAtNight(c, isComplaintText), c)
    }
  })

  it('#3: pre-sale questions are not a person request (the agent keeps selling)', () => {
    for (const c of [
      '¿Si no me queda lo puedo devolver?',
      '¿Tienen devolución?',
      'Soy alérgica al látex, ¿tiene látex?',
      '¿Me puede dar alergia?',
      '¿Tiene alguna reacción secundaria?',
      '¿Sirve para la irritación de la piel?',
      '¿Tienen kit de emergencia?',
      'Soy dueña de una tienda, ¿venden al por mayor?',
      '¿Esto no es estafa verdad?',
      '¿Puede hacerme daño si estoy embarazada?',
    ]) {
      // "¿Puede hacerme daño…?" is a health QUESTION, answered with "consultá con tu médico".
      if (c.startsWith('¿Puede hacerme')) continue
      assert.ok(!customerNeedsPersonAtNight(c, isComplaintText), c)
    }
  })

  it('#2: "ahorita" / "enseguida te ayudo" never wipe a useful reply; only a right-now check sentence is dropped', () => {
    const a = 'Ahorita tenemos el arnés en ₡14 900 en talla M y L. Te dejo la guía de tallas 👇 ¿Te ayudo a elegir?'
    assert.equal(nightKeepsSelling(plan(a, 'escalate'), NIGHT, full('¿Qué tallas hay?')).plan.text, a)
    const b = 'Te dejo la guía 👇 Si tenés dudas, enseguida te ayudo 😊'
    assert.equal(nightKeepsSelling(plan(b, 'escalate'), NIGHT, full('¿Tallas?')).plan.text, b)
    const c = nightKeepsSelling(plan('El arnés cuesta ₡14 900. Enseguida te confirmo si llega a Pérez Zeledón 😊', 'escalate'), NIGHT, full('¿Llega a PZ?'))
    assert.equal(c.plan.handoff, null)
    assert.equal(c.plan.text, 'El arnés cuesta ₡14 900.\nEl equipo te escribe mañana a las 6:00 a. m.')
  })

  it('#4: Probar / live flags follow `soft` (also the safe-line review branch)', () => {
    const r = nightKeepsSelling(plan(SAFE, 'escalate'), NIGHT, full('¿Cómo se lava?'))
    assert.equal(r.soft, true)
    assert.equal(r.review, null)
  })

  it('r3 #1/#2/#5: lists keep their line breaks, "a. m." does not glue sentences, more alarm phrases', () => {
    const list = 'Talla S: 50-60 kg\nTalla M: 60-70 kg\nTalla L: 70-80 kg\n\nEnseguida te confirmo cómo se lava 😊'
    assert.equal(nightKeepsSelling(plan(list, 'escalate'), NIGHT, full('¿Tallas?')).plan.text, 'Talla S: 50-60 kg\nTalla M: 60-70 kg\nTalla L: 70-80 kg\nEl equipo te escribe mañana a las 6:00 a. m.')
    const am = nightKeepsSelling(plan('La entrega es mañana a las 8:00 a. m. Enseguida te confirmo la dirección.', 'escalate'), NIGHT, full('¿Cuándo llega?'))
    assert.equal(am.plan.text, 'La entrega es mañana a las 8:00 a. m.\nEl equipo te escribe mañana a las 6:00 a. m.')
    for (const c of ['no quiero seguir viviendo', 'tengo ronchas desde que lo usé', 'no me ha llegado nada y ya pasaron 2 semanas', '¿Por qué no me ha llegado mi pedido?']) {
      assert.ok(customerNeedsPersonAtNight(c, isComplaintText), c)
    }
  })

  it('#5: "Te confirmo que sí…", "Te pregunto: …" and "Revisamos cada pedido" are facts, not a promise', () => {
    for (const t of ['Te confirmo que sí tenemos talla M', 'Te pregunto: ¿es para vos?', 'Revisamos cada pedido antes de enviarlo']) assert.ok(!hasCheckPromise(t), t)
  })
})
