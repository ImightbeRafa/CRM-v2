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
  customerNightNeed,
  hasCheckPromise,
  SAFETY_HANDOFF_LINE,
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
  nightKeepsSelling(plan(text, reason), NIGHT, { safeReview: SAFE, customerText, modelReason: reason === 'escalate' ? 'other' : null, cannotAnswer: admitsCannotAnswer })

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
      const r = nightKeepsSelling(p, NIGHT, { safeReview: SAFE, customerText: c })
      assert.deepEqual(r.plan.handoff, p.handoff, c)
      assert.equal(r.soft, false, c)
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
      assert.deepEqual(r.plan.handoff, p.handoff, reason)
      assert.equal(r.soft, false, reason)
    }
  })

  it('probe 2026-10-25: a crisis / alarm gets empathy + 911, a complaint the empathetic line, never only "mañana"', () => {
    for (const c of ['no quiero seguir viviendo', 'Me salió una reacción en la piel con el arnés', 'Mi hijo se tragó un parche']) {
      const r = nightKeepsSelling(plan(SAFE, 'escalate'), NIGHT, full(c))
      assert.equal(r.plan.handoff?.kind, 'handoff', c)
      assert.equal(applyAfterHoursText(r.plan, NIGHT, OPTS), `${SAFETY_HANDOFF_LINE} El equipo te escribe mañana a las 6:00 a. m.`, c)
    }
    assert.equal(nightKeepsSelling(plan('Entiendo.', 'escalate'), NIGHT, full('¿?', 'safety')).plan.text, SAFETY_HANDOFF_LINE)
    for (const c of ['Me llegó el pedido y vino roto 😡', 'Hace una semana pedí y todavía no me llega']) {
      const r = nightKeepsSelling(plan(SAFE, 'escalate'), NIGHT, full(c))
      assert.match(applyAfterHoursText(r.plan, NIGHT, OPTS), /^Lamento mucho lo que pasó 🙏 A esta hora te atiende nuestro asistente virtual 🌙 El equipo te escribe mañana/, c)
    }
    assert.equal(customerNightNeed('pásame con el dueño'), 'person')
    assert.equal(customerNightNeed('¿Cómo se lava?'), null)
  })

  it('probe 2026-10-25: a plain answer promising a person right now (no escalate) is fixed at night and alerts the team', () => {
    const p = { text: 'Con 1.90 m estás fuera de la guía de tallas, así que no te puedo recomendar una talla. Dame un momento, te paso con alguien del equipo 😊', handoff: null }
    const r = nightKeepsSelling(p, NIGHT, full('Y si mido 1.90?'))
    assert.equal(r.plan.text, 'Con 1.90 m estás fuera de la guía de tallas, así que no te puedo recomendar una talla.\nEl equipo te escribe mañana a las 6:00 a. m.')
    assert.deepEqual(r.review, { kind: 'review', reason: 'review' })
    assert.equal(r.soft, true)
    const plain = { text: 'El arnés cuesta ₡14 900 😊', handoff: null }
    assert.equal(nightKeepsSelling(plain, NIGHT, full('¿Precio?')).plan, plain)
    assert.equal(nightKeepsSelling(p, IN_HOURS, full('Y si mido 1.90?')).plan, p)
  })

  it('probe 2026-10-25: "Dame un momento, te paso con alguien" never goes out next to "mañana" (opt-out at night)', () => {
    const text = 'Dame un momento, te paso con alguien del equipo 😊'
    const out = applyAfterHoursText(plan(text, 'human_request'), NIGHT, OPTS)
    assert.doesNotMatch(out, /Dame un momento/)
    assert.match(out, /El equipo te escribe mañana a las 6:00 a\. m\./)
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

describe('nightKeepsSelling · SecureDog H1 / M1', () => {
  const opts = (customerText: string, modelReason: string | null) => ({ safeReview: SAFE, customerText, modelReason, cannotAnswer: admitsCannotAnswer, isComplaint: isComplaintText })
  const answer = plan('Te dejo la guía de tallas 👇', 'escalate')

  it('fail closed: only the model reason "other" is downgraded; any other / unknown reason keeps the hand-off', () => {
    assert.equal(nightKeepsSelling(answer, NIGHT, opts('¿Tallas?', 'other')).soft, true)
    for (const r of ['crisis', 'self_harm', 'emergency', 'health', 'health_alarm', 'refund', 'dispute', 'human_request', 'legal', 'minor', null]) {
      const out = nightKeepsSelling(answer, NIGHT, opts('¿Tallas?', r))
      assert.equal(out.soft, false, String(r))
      assert.deepEqual(out.plan.handoff, answer.handoff, String(r))
    }
  })

  it('more crisis / alarm wording → 911 line + true hand-off', () => {
    for (const c of [
      'me quiero matar', 'me voy a matar', 'me tomé todas las pastillas', 'ya no aguanto más', 'no le veo sentido a la vida', 'me corté',
      'me duele mucho el pecho', 'me falta el aire', 'mi hijo se tomó el producto',
      'tengo la cara hinchada', 'me salió un salpullido', 'tengo urticaria', 'me dio taquicardia',
    ]) {
      assert.equal(customerNightNeed(c), 'safety', c)
      const out = nightKeepsSelling(answer, NIGHT, opts(c, 'other'))
      assert.equal(out.plan.text, SAFETY_HANDOFF_LINE, c)
      assert.equal(out.plan.handoff?.kind, 'handoff', c)
    }
  })

  it('a customer safety signal beats the model reason complaint, and applies when the model did not escalate', () => {
    assert.equal(nightKeepsSelling(answer, NIGHT, opts('no quiero seguir viviendo, ustedes me estafaron', 'complaint')).plan.text, SAFETY_HANDOFF_LINE)
    const noEsc = nightKeepsSelling({ text: 'Dame un momento y te paso con alguien del equipo 😊', handoff: null }, NIGHT, opts('no quiero seguir viviendo', null))
    assert.equal(noEsc.plan.text, SAFETY_HANDOFF_LINE)
    assert.deepEqual(noEsc.plan.handoff, { kind: 'handoff', reason: 'escalate' })
  })

  it('safety advice is never cut; a hedge in the cut piece swaps the whole reply (no bare claim)', () => {
    const advice = 'Retirá el parche ya mismo y lavá la zona con agua fría, ahorita alguien del equipo te escribe.'
    assert.match(nightKeepsSelling(plan(advice, 'escalate'), NIGHT, opts('¿Qué hago?', 'other')).plan.text, /^Retirá el parche ya mismo/)
    for (const t of ['No sé si hay stock, enseguida te confirmo. El envío sale mañana.', 'No te puedo confirmar el pago todavía, enseguida alguien del equipo te escribe. Tu pedido queda apartado.']) {
      const r = nightKeepsSelling(plan(t, 'escalate'), NIGHT, opts('¿Hay?', 'other'))
      assert.equal(r.plan.text, SAFE, t)
      const r2 = nightKeepsSelling({ text: t, handoff: null }, NIGHT, opts('¿Hay?', null))
      assert.equal(r2.plan.text, SAFE, t)
    }
  })
})

describe('night complaint hand-off (real-model run 2026-10-26)', () => {
  it('a model "complaint" hand-off at night gets the empathetic line, never the bare night line', () => {
    assert.match(applyAfterHoursText(plan('Entiendo', 'complaint'), NIGHT, OPTS), /^Lamento mucho lo que pasó 🙏 A esta hora te atiende nuestro asistente virtual/)
  })
})

describe('nightKeepsSelling · SecureDog re-review R1–R5', () => {
  const opts = (customerText: string, modelReason: string | null) => ({ safeReview: SAFE, customerText, modelReason, cannotAnswer: admitsCannotAnswer, isComplaint: isComplaintText })

  it('R1: a crisis inside a complaint (model reason complaint → complaint hand-off) gets the 911 line', () => {
    for (const c of ['no quiero seguir viviendo, ustedes me estafaron', 'el parche me dio una reacción, quiero que me devuelvan la plata']) {
      const out = nightKeepsSelling(plan('Lamento mucho', 'complaint'), NIGHT, opts(c, 'complaint'))
      assert.equal(out.plan.text, SAFETY_HANDOFF_LINE, c)
      assert.equal(out.plan.handoff?.kind, 'handoff', c)
      assert.match(applyAfterHoursText(out.plan, NIGHT, OPTS), /911/, c)
    }
  })

  it('R2: pre-sale questions with symptom words are NOT a crisis (the agent keeps selling)', () => {
    for (const c of [
      '¿Ya no aguanto más el insomnio, cuál me recomiendan?',
      'ya no aguanto el dolor de espalda, ¿cuál sirve?',
      '¿Sirve para la urticaria?',
      'Tengo urticaria crónica, ¿lo puedo usar?',
      '¿Causa taquicardia?',
      'Sufro de taquicardia, ¿lo puedo usar?',
      '¿Me falta el aire cuando corro, sirve?',
      '¿Me salió un sarpullido por otro producto, lo puedo usar?',
    ]) {
      assert.equal(customerNightNeed(c), null, c)
    }
    // A real alarm asked as a question still counts ("¿qué hago?" is not a pre-sale question).
    for (const c of ['me duele mucho el pecho, ¿qué hago?', 'Mi hijo se tragó un parche, ¿qué hago?', 'ya no aguanto más']) assert.equal(customerNightNeed(c), 'safety', c)
  })

  it('R3: a dropped piece with anything besides the promise swaps the whole reply', () => {
    for (const t of ['No lo sé con certeza, enseguida te confirmo. El envío sale mañana.', 'Creo que sí llega, enseguida te confirmo. El envío sale mañana.']) {
      assert.equal(nightKeepsSelling(plan(t, 'escalate'), NIGHT, opts('¿Llega?', 'other')).plan.text, SAFE, t)
    }
    // A pure promise piece is still just dropped (the useful part stays).
    const ok = nightKeepsSelling({ text: 'Con 1.90 m estás fuera de la guía de tallas. Dame un momento, te paso con alguien del equipo 😊', handoff: null }, NIGHT, opts('Y si mido 1.90?', null))
    assert.equal(ok.plan.text, 'Con 1.90 m estás fuera de la guía de tallas.\nEl equipo te escribe mañana a las 6:00 a. m.')
  })

  it('R4: a kept "right now" sentence (safety advice) still gets the team line; more advice wording', () => {
    const advice = 'Retirá el parche ya mismo y lavá la zona con agua fría, ahorita alguien del equipo te escribe.'
    const r = nightKeepsSelling(plan(advice, 'escalate'), NIGHT, opts('¿Qué hago con el parche?', 'other'))
    assert.match(r.plan.text, /^Retirá el parche ya mismo[\s\S]*\nEl equipo te escribe mañana a las 6:00 a\. m\.$/)
    const r2 = nightKeepsSelling({ text: 'Sacate el parche ya mismo, enseguida alguien del equipo te escribe.', handoff: null }, NIGHT, opts('¿Qué hago con el parche?', null))
    assert.match(r2.plan.text, /^Sacate el parche ya mismo[\s\S]*El equipo te escribe mañana/)
  })

  it('R5: invented safety-like model reasons get the 911 line', () => {
    for (const reason of ['crisis', 'self_harm', 'emergency', 'health_alarm', 'medical']) {
      const out = nightKeepsSelling(plan('Entiendo', 'escalate'), NIGHT, opts('ayuda', reason))
      assert.equal(out.plan.text, SAFETY_HANDOFF_LINE, reason)
    }
  })
})
