/**
 * Rafael 2026-11-06 — Meta's ready-made ad questions ("¿Es adecuado para personas con dolores de espalda crónicos?")
 * got an answer AND a model escalation, so the chat sat in "Necesita persona" and the sale stopped; "Devolver a IA"
 * left it there; and replies asked "¿Querés que te pase la guía de tallas?" right after the guide image went out.
 * Real texts from production chats (2026-10-23 … 2026-11-06) + the Verifier's failing inputs. Pure + source asserts.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  nightKeepsSelling,
  presaleDelivery,
  presaleEscalationIsAnswer,
  promisesPerson,
  PRESALE_NEXT_STEP_LINE,
  withPresaleNextStep,
} from '@/lib/soft-ai/business-hours'
import { admitsCannotAnswer, isComplaintText, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { fixSizeGuideOffer, SIZE_GUIDE_NEXT_QUESTION, sizeGuidePromptLine, sizeGuideState } from '@/lib/soft-ai/size-guide'
import { resumeClearsHandoff } from '@/lib/chat-unanswered-server'
import { classifyPaymentText, hasHardPaymentClaim } from '@/lib/soft-ai/payment-classifier'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import type { AgentAsset } from '@/lib/soft-ai/agent-assets'

const root = process.cwd()
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

const BACK = '¿Es adecuado para personas con dolores de espalda crónicos?'
const BACK_REPLY =
  'Hola, soy Andrés de ForgeCR 💪 Es una ayuda para recordar y sostener una buena postura, no un tratamiento médico. Si el dolor es crónico, consultá con tu médico antes de usarlo.'
const ESC = { kind: 'handoff' as const, reason: 'escalate' }
const isAnswer = (customerText: string, modelReason: string | null, text = BACK_REPLY) =>
  presaleEscalationIsAnswer({ text, textOk: true, handoff: ESC, modelReason, customerText, cannotAnswer: admitsCannotAnswer, isComplaint: isComplaintText })

describe('pre-sale question the agent fully answered: no hand-off (Meta ad questions)', () => {
  it('the Forge ad question (with the shared post placeholder) is an answer for reason other and safety', () => {
    assert.equal(isAnswer(BACK, 'other'), true)
    assert.equal(isAnswer(BACK, 'safety'), true)
    assert.equal(isAnswer(`[ig_post]\n${BACK}`, 'safety'), true)
    assert.equal(isAnswer('¿Son seguros para personas con alergias?', 'safety', 'Si tenés alergia a algún ingrediente, mejor no usarlos; consultá con tu médico.'), true)
    assert.equal(isAnswer('¿Cómo se debe lavar?', 'other', 'Se lava a mano con agua fría y jabón suave, y se seca a la sombra.'), true)
  })

  it('Verifier 2026-11-06 #1: something that happened (a symptom, a reaction, a child, "estoy mal", "ayuda") is never downgraded', () => {
    const cases = [
      'Me puse el parche anoche y hoy me pica toda la espalda y tengo manchas rojas',
      'Desde que uso el parche siento el corazón muy acelerado',
      'Me siento mareada desde que me puse el parche',
      'Mi hija de 4 años mordió un parche',
      'Mi esposo se tomó dos de las gomitas de más y está raro',
      'estoy muy mal, no sé qué hacer',
      'ayuda',
      '¿Es normal que me pique la espalda desde que uso el arnés?',
      '¿Es grave? Me salieron ronchas',
    ]
    for (const q of cases) {
      for (const reason of ['safety', 'other']) {
        assert.equal(isAnswer(q, reason, 'Retirá el parche ya mismo y consultá con tu médico.'), false, `${reason}: ${q}`)
      }
    }
  })

  it('Verifier r2 #2: a reply that hands over to a person, or a customer asking for one, keeps the hand-off', () => {
    assert.equal(isAnswer('¿Me pasan con alguien del equipo?', 'other', 'Claro, te paso con alguien del equipo 😊'), false)
    assert.equal(isAnswer('¿Me pasan con alguien del equipo?', 'other', '¡Claro! Ya le aviso al equipo para que te escriba 😊'), false)
    assert.equal(isAnswer('¿Hay alguien real ahí?', 'other', 'Sí, el equipo revisa los chats y te va a escribir una persona 😊'), false)
    assert.equal(isAnswer('¿Cómo se debe lavar?', 'other', 'Se lava a mano. Ya le aviso al equipo para confirmarte.'), false)
  })

  it('SecureDog INT-PRE-3: every way of promising a person keeps the hand-off (presale and Devolver a IA)', () => {
    const replies = [
      'Le comento a la dueña y te contacta hoy mismo.',
      'Con gusto, le paso tu consulta a la dueña y ella te contacta.',
      'Ya le pasé tu mensaje a la encargada, ella te escribe por aquí.',
      'Te van a contactar del equipo para ayudarte con eso.',
      'Un compañero te escribe en un rato.',
      'Le dejo tu consulta a mi compañera y ella te responde.',
      'Te contactarán por este medio para confirmarlo.',
      'Te escribirán por aquí con ese dato.',
      'Le aviso a la dueña para que te ayude con la factura.',
      'Dejé tu consulta anotada y te respondemos pronto.',
      'En breve alguien te contacta.',
      'Ese dato lo maneja el equipo; por aquí te van a escribir 😊',
    ]
    for (const r of replies) {
      assert.equal(promisesPerson(r), true, r)
      assert.equal(isAnswer('¿Hacen factura electrónica?', 'other', r), false, r)
      assert.equal(resumeClearsHandoff({ text: r, reason: 'escalate', subReason: 'other', fallbackUsed: false, intent: 'other' }), false, r)
    }
    // A real answer that sells is not a promise of a person.
    assert.equal(promisesPerson('Se lava a mano con agua fría. ¿Querés que te ayude a elegir tu talla?'), false)
    assert.equal(promisesPerson(BACK_REPLY), false)
  })

  it('SecureDog r3: question-shaped person requests and late-order complaints keep the hand-off', () => {
    for (const q of ['¿Me pueden pasar con alguien?', '¿Me pueden atender por favor?', '¿Por qué no me contestan?', '¿Por qué el pedido llegó tarde?', 'Ya pasaron 2 semanas, ¿cuándo me llega?']) {
      assert.equal(isAnswer(q, 'other', 'Claro 😊 Cuesta ₡14 900.'), false, q)
    }
  })

  it('Verifier r2 #3: symptoms asked as questions keep the hand-off', () => {
    for (const q of [
      '¿Es normal que me pique la piel después de usarlo?',
      '¿Es normal que me duela la cabeza con el parche?',
      '¿Por qué me salen granitos con el parche?',
      '¿Es normal sentir mareos con las gomitas?',
      '¿Es normal tener manchas rojas después de usarlo?',
      '¿Por qué siento hormigueo en la espalda?',
    ]) {
      assert.equal(isAnswer(q, 'other', 'Retiralo y consultá con tu médico.'), false, q)
    }
  })

  it('a statement (not a question) keeps the hand-off; "safety" only for the exact ad questions', () => {
    assert.equal(isAnswer('Avísame cuando lleguen las 2XL', 'other', 'La 2XL está disponible 😊'), false)
    assert.equal(isAnswer('Tengo dolor de espalda crónico', 'safety'), false)
    assert.equal(isAnswer('¿Cuánto cuesta el soporte?', 'safety', 'Cuesta ₡14 900.'), false)
    assert.equal(isAnswer('¿Es adecuado para mi dolor de rodilla?', 'safety'), false)
    assert.equal(isAnswer('¿es adecuado para personas con dolores de espalda cronicos', 'safety'), false, 'no question mark')
    assert.equal(isAnswer('¿ES ADECUADO PARA PERSONAS CON DOLORES DE ESPALDA CRÓNICOS?', 'safety'), true)
  })

  it('live 2026-11-06 20:40Z: two ad questions tapped together (price + back pain) is still an answer', () => {
    const burst = `[ig_post]\n¿Cuánto cuesta el soporte de ForgeCR?\n[ig_post]\n${BACK}`
    assert.equal(isAnswer(burst, 'safety'), true)
    // The health ad question never carries a real alarm along with it.
    assert.equal(isAnswer(`${BACK}\n¿Es seguro si mi bebé lo chupó?`, 'safety'), false)
    assert.equal(isAnswer(`${BACK}\nMe pica la espalda desde ayer`, 'safety'), false)
    assert.equal(isAnswer(`${BACK}\n¿Cuántas pastillas se puede tomar uno para no despertar?`, 'safety'), false)
  })

  it('SecureDog INT-PRE-1: crisis / child / current-symptom questions never lose the hand-off (other or safety)', () => {
    const cases = [
      '¿Es seguro tomarse 20 pastillas para dormir de una vez?',
      '¿Cuántas pastillas se puede tomar uno para no despertar?',
      '¿Es seguro si mi bebé lo chupó?',
      '¿Le hace daño a un niño de 3 años si lo lamió?',
      '¿Es seguro si mi hija se lo pegó en la boca?',
      '¿Es seguro usarlo si tengo el corazón acelerado desde ayer?',
      '¿Se puede usar si ahorita me cuesta respirar?',
      'Mi hijo de 2 años se comió un pedazo del parche',
      'Me tomé 20 pastillas',
      'Ya no quiero estar aquí, quiero desaparecer',
      'Estoy pensando en acabar con todo',
      'Desde que me puse el parche siento que me ahogo',
      'Mi bebé tiene fiebre desde que le pusimos el parche',
      '¿?',
    ]
    for (const q of cases) {
      for (const reason of ['safety', 'other']) assert.equal(isAnswer(q, reason, 'Llamá al 911 si es una emergencia.'), false, `${reason}: ${q}`)
    }
  })

  it('keeps the true hand-off when the agent promises to check / cannot answer / the reply failed', () => {
    const q = '¿Será que tienen AINEs?'
    for (const a of ['Dejame revisarlo y te confirmo 😊', 'No tengo ese dato acá, lo confirmo con el equipo.']) assert.equal(isAnswer(q, 'other', a), false, a)
    assert.equal(presaleEscalationIsAnswer({ text: BACK_REPLY, textOk: false, handoff: ESC, modelReason: 'other', customerText: BACK }), false)
  })

  it('a complaint or a person request keeps the hand-off', () => {
    for (const q of ['¿Por qué me llegó roto el arnés?', '¿Puedo hablar con una persona?', '¿Me pueden llamar?']) {
      assert.equal(isAnswer(q, 'other', 'Claro 😊'), false, q)
    }
  })

  it('never other reasons, a review or a code hand-off', () => {
    for (const reason of ['payment_or_sinpe', 'payment_claim', 'opt_out', 'complaint', 'ownership', 'media_inbound', 'crisis', null]) {
      assert.equal(isAnswer(BACK, reason), false, String(reason))
    }
    assert.equal(presaleEscalationIsAnswer({ text: BACK_REPLY, textOk: true, handoff: { kind: 'review', reason: 'review' }, modelReason: 'other', customerText: BACK }), false)
    assert.equal(presaleEscalationIsAnswer({ text: BACK_REPLY, textOk: true, handoff: { kind: 'handoff', reason: 'payment' }, modelReason: 'other', customerText: BACK }), false)
  })

  it('Verifier #5: planned without the model hand-off, a code-owned review (payment data by the team) survives', () => {
    const plan = planModelTurnDelivery({ text: BACK_REPLY, textOk: true, llmHandoff: null, llmEscalateReason: null, paymentDataByTeam: true, customerText: BACK })
    assert.equal(plan.handoff?.kind, 'review')
    const out = presaleDelivery(true, { modelReason: 'other', stage: 'cierre' }, plan)
    assert.equal(out, plan)
  })

  it('next selling step: only for reason other, before a close, when the reply asks nothing', () => {
    assert.equal(withPresaleNextStep('Se lava a mano.', { modelReason: 'other', stage: 'descubrir' }), `Se lava a mano.\n\n${PRESALE_NEXT_STEP_LINE}`)
    assert.equal(withPresaleNextStep('Se lava a mano. ¿Qué talla usás?', { modelReason: 'other', stage: 'descubrir' }), 'Se lava a mano. ¿Qué talla usás?')
    assert.equal(withPresaleNextStep(BACK_REPLY, { modelReason: 'safety', stage: 'saludo' }), BACK_REPLY)
    for (const stage of ['cierre', 'metodo_pago', 'esperando_comprobante', 'verificando', 'pedido_en_revision']) {
      assert.equal(withPresaleNextStep('Se lava a mano.', { modelReason: 'other', stage }), 'Se lava a mano.', stage)
    }
    assert.equal(withPresaleNextStep('Se lava a mano.', { modelReason: 'other', stage: 'cotizar', dataReceived: true }), 'Se lava a mano.')
  })

  it('at night the Forge question no longer gets the 911 line (planned without the model hand-off)', () => {
    const night = { afterHours: true, label: 'mañana a las 6:00 a. m.', transparent: true, opensAt: null } as never
    const plan = planModelTurnDelivery({ text: BACK_REPLY, textOk: true, llmHandoff: null, llmEscalateReason: null, customerText: BACK })
    const r = nightKeepsSelling(plan, night, { safeReview: SAFE_LINE.review, customerText: BACK, cannotAnswer: admitsCannotAnswer, isComplaint: isComplaintText })
    assert.equal(r.plan.handoff, null)
    assert.ok(!/911/.test(r.plan.text))
  })

  it('the escalate tool says a pre-sale health question is never an alarm', () => {
    const src = read('src/lib/soft-ai/llm/tool-definitions.ts')
    assert.match(src, /dolor crónico, alergias/)
    assert.match(src, /NUNCA es una señal de alarma/)
  })

  it('live turn and Probar plan the turn without the model hand-off only through turnPresaleIsAnswer', () => {
    const src = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal((src.match(/turnPresaleIsAnswer\(llm, policy,/g) || []).length, 2)
    assert.match(src, /llmHandoff: presale \? null : llm\.handoff,/)
    assert.match(src, /llmHandoff: probarPresale \? null : llm\.handoff,/)
    assert.match(src, /if \(llm\.fallbackUsed \|\| llm\.modelAskedHuman !== false \|\| llm\.toolProblem !== false \|\| policy\.needsHuman\) return false/)
    assert.match(src, /if \(classifyPaymentText\(customerText\) !== 'non_payment'\) return false/)
    assert.match(src, /presaleKeptSelling/)
  })
})

describe('size guide already in the chat: never offered again', () => {
  const shortcuts = [{ id: 's1', key: 'tallas', title: 'Tallas', body: 'Guía', isActive: true, kind: 'playbook' } as unknown as RuntimeShortcut]
  const asset = { id: 'a1', sha256: 'sha-a1', mimeType: 'image/png', url: 'https://x/a.png', name: 'guia.png' } as unknown as AgentAsset
  const assets = new Map([['s1', [asset]]])

  it('state: none / pending / sent', () => {
    assert.equal(sizeGuideState({ guideKey: null, shortcuts, assetsByShortcut: assets }), 'none')
    assert.equal(sizeGuideState({ guideKey: 'tallas', shortcuts, assetsByShortcut: assets, alreadySent: [] }), 'pending')
    assert.equal(sizeGuideState({ guideKey: 'tallas', shortcuts, assetsByShortcut: assets, alreadySent: ['sha-a1'] }), 'sent')
    assert.equal(sizeGuideState({ guideKey: 'tallas', shortcuts, assetsByShortcut: assets, alreadySent: ['a1'] }), 'sent')
    assert.equal(sizeGuideState({ guideKey: 'tallas', shortcuts, assetsByShortcut: new Map() }), 'none')
    assert.equal(sizeGuideState({ guideKey: 'otra', shortcuts, assetsByShortcut: assets }), 'none')
  })

  it('prompt line only when the guide is already in the chat; never asks weight', () => {
    assert.match(sizeGuidePromptLine('sent') || '', /YA se le envió/)
    assert.equal(sizeGuidePromptLine('pending'), null)
    assert.equal(sizeGuidePromptLine('none'), null)
    assert.ok(!/peso|estatura|dato/i.test(sizeGuidePromptLine('sent') || ''))
    assert.ok(!/peso|estatura/i.test(SIZE_GUIDE_NEXT_QUESTION))
  })

  it('real replies 2026-11-04: the offer goes, the price stays, a size question is added', () => {
    const r = fixSizeGuideOffer('¡Hola! Soy Andrés de ForgeCR 😊 El Arnés ForgeCR cuesta ₡14 900 con envío incluido.\n\n¿Querés ver la guía de tallas?')
    assert.equal(r.text, `¡Hola! Soy Andrés de ForgeCR 😊 El Arnés ForgeCR cuesta ₡14 900 con envío incluido.\n\n${SIZE_GUIDE_NEXT_QUESTION}`)
    const p = fixSizeGuideOffer('Es una ayuda para recordar una buena postura, no un tratamiento médico. ¿Querés que te comparta la guía de tallas?')
    assert.equal(p.text, `Es una ayuda para recordar una buena postura, no un tratamiento médico.\n\n${SIZE_GUIDE_NEXT_QUESTION}`)
  })

  it('Verifier #3: prices with dots, emoji-joined sentences and real questions are never cut', () => {
    assert.equal(
      fixSizeGuideOffer('El arnés cuesta ₡14.900 con envío incluido 😊 ¿Querés ver la guía de tallas?').text,
      `El arnés cuesta ₡14.900 con envío incluido 😊\n\n${SIZE_GUIDE_NEXT_QUESTION}`,
    )
    assert.equal(
      fixSizeGuideOffer('El arnés cuesta ₡14 900 con envío incluido 😊 ¿Querés que te pase la guía de tallas?').text,
      `El arnés cuesta ₡14 900 con envío incluido 😊\n\n${SIZE_GUIDE_NEXT_QUESTION}`,
    )
    const keepQ = '¡Hola! 😊 El Arnés ForgeCR cuesta ₡14 900 y te paso la guía de tallas para que elijás ¿Cuál talla usás?'
    assert.deepEqual(fixSizeGuideOffer(keepQ), { text: keepQ, changed: false })
    const flip = fixSizeGuideOffer('Te paso la guía de tallas 👇 ¿Qué talla usás normalmente?')
    assert.equal(flip.text, 'Te paso la guía de tallas 👆 ¿Qué talla usás normalmente?')
    const notOffer = '¿Necesitás algo más además de la guía de tallas?'
    assert.deepEqual(fixSizeGuideOffer(notOffer), { text: notOffer, changed: false })
    const doubt = '¡Buenos días! 😊 ¿Te quedó alguna duda sobre la guía de tallas?'
    assert.deepEqual(fixSizeGuideOffer(doubt), { text: doubt, changed: false })
  })

  it('every offer shape goes; the combined offer too; a question without "¿" too', () => {
    for (const q of [
      '¿Querés que te pase la guía de tallas?',
      '¿Querés que te mande la guía de tallas?',
      '¿Querés saber cómo funciona o ver la guía de tallas?',
      '¿Te paso la guía de tallas?',
      'Querés que te pase la guía de tallas?',
    ]) {
      const r = fixSizeGuideOffer(`El arnés cuesta ₡14 900. ${q}`)
      assert.equal(r.text, `El arnés cuesta ₡14 900.\n\n${SIZE_GUIDE_NEXT_QUESTION}`, q)
    }
  })

  it('Verifier r2 #4: no emoji-only bubble, and an offer without "¿" never takes the price with it', () => {
    assert.equal(
      fixSizeGuideOffer('El arnés cuesta ₡14 900.\n\n¿Querés que te pase la guía de tallas? 😊').text,
      `El arnés cuesta ₡14 900.\n\n${SIZE_GUIDE_NEXT_QUESTION}`,
    )
    assert.equal(fixSizeGuideOffer('El arnés cuesta ₡14.900 querés ver la guía de tallas?').text, `El arnés cuesta ₡14.900\n\n${SIZE_GUIDE_NEXT_QUESTION}`)
    assert.equal(fixSizeGuideOffer('Cuesta ₡14 900 😊 Querés que te pase la guía de tallas?').text, `Cuesta ₡14 900 😊\n\n${SIZE_GUIDE_NEXT_QUESTION}`)
    assert.equal(fixSizeGuideOffer('Precio ₡14 900, querés ver la guía de tallas?').text, `Precio ₡14 900\n\n${SIZE_GUIDE_NEXT_QUESTION}`)
    const emojiLine = 'Hola 😊\n\n💪\n\nCuesta ₡14 900. ¿Te ayudo?'
    assert.deepEqual(fixSizeGuideOffer(emojiLine), { text: emojiLine, changed: false })
  })

  it('keeps the other question and points 👇 at the image above', () => {
    const r = fixSizeGuideOffer('Por tu peso, te corresponde la talla 4XL (91–100 kg). Te dejo la guía de tallas 👇 ¿Querés que te ayude a apartarla?')
    assert.equal(r.text, 'Por tu peso, te corresponde la talla 4XL (91–100 kg). Te dejo la guía de tallas 👆 ¿Querés que te ayude a apartarla?')
  })

  it('text without the guide is untouched', () => {
    const t = 'El arnés cuesta ₡14 900. ¿Querés llevarte uno o el Pack de 2?'
    assert.deepEqual(fixSizeGuideOffer(t), { text: t, changed: false })
  })

  it('live fixes the text before any image goes out (reclaim-safe); Probar does the same', () => {
    const src = read('src/lib/soft-ai/agent-turn.ts')
    const fix = src.indexOf('await fixGuideText(assets.map((a) => a.id))')
    const send = src.indexOf('await sendAgentImagesOnce(mediaCtx, assets)')
    assert.ok(fix > 0 && send > fix)
    assert.match(src, /await fixGuideText\(\[\]\)/)
    assert.equal((src.match(/fixSizeGuideOffer\(/g) || []).length, 2)
    assert.equal((src.match(/sizeGuidePromptLine\(/g) || []).length, 2)
  })
})

describe('Pura Sonrisa live 2026-11-06: "no he hecho el pedido" is not a payment', () => {
  const RAQUEL = 'Hola, qué pena no he hecho el pedido y quiero saber cómo se usan las tiras blanqueadoras'

  it('saying the order was NOT placed is no payment claim; real claims next to it still are', () => {
    for (const t of [RAQUEL, 'no he hecho el pedido', 'Todavía no hice mi pedido', 'Aún no he realizado la compra']) {
      assert.equal(classifyPaymentText(t), 'non_payment', t)
      assert.equal(hasHardPaymentClaim(t), false, t)
    }
    for (const t of ['no he hecho el pedido, ya pagué', 'no he hecho el pedido pero ya hice el sinpe', 'no he hecho el pedido, adjunto comprobante', 'ya hice el pedido', 'aún no he hecho el pago']) {
      assert.equal(hasHardPaymentClaim(t), true, t)
    }
  })

  it('SecureDog delta: a charge / debit / done word / verify request next to it keeps the hand-off', () => {
    for (const t of [
      'no he hecho el pedido pero me debitaron',
      'no he hecho el pedido, pero el BAC me rebajó',
      'No hice ninguna compra y me sale un cargo',
      'no hice ningún pedido, me están cobrando',
      'no he hecho el pedido, verifiquen',
      'no he hecho el pedido 💸',
      'no hice el pedido, sent',
      'no hice el pedido. Done.',
      'no he hecho el pedido, ahí está',
      'no he hecho el pedido pero ya le pasé la plata',
      'no hice el pedido, les deposité',
    ]) {
      assert.equal(hasHardPaymentClaim(t), true, t)
    }
  })
})

describe('Devolver a IA leaves "Necesita persona" only when the agent really answered', () => {
  const turn = (over: Partial<Parameters<typeof resumeClearsHandoff>[0]>) =>
    resumeClearsHandoff({ text: BACK_REPLY, reason: 'escalate', subReason: 'other', fallbackUsed: false, intent: 'other', ...over })

  it('a missing-fact hand-off whose answer went out is closed', () => {
    assert.equal(turn({}), true)
  })

  it('Verifier r2 #1: an admitted gap / check promise / promised person is never closed (unknown_answer never)', () => {
    assert.equal(turn({ reason: 'unknown_answer', subReason: null }), false)
    assert.equal(turn({ text: 'No tengo ese dato acá, te confirmo enseguida 😊' }), false)
    assert.equal(turn({ text: 'El arnés cuesta ₡14 900. No tengo el dato del envío a Nicaragua, lo confirmo con el equipo.' }), false)
    assert.equal(turn({ text: 'Hola 😊 Ya le aviso al equipo para que te ayude con eso.' }), false)
    assert.equal(turn({ text: 'Ese dato lo maneja el equipo; por aquí te van a escribir 😊' }), false)
    assert.equal(turn({ text: 'Eso lo revisa la dueña y te responde por aquí 😊' }), false)
    assert.equal(turn({ text: 'El envío a Limón tarda 2-3 días 😊' }), true)
  })

  it('SecureDog INT-RSM-1: safety / ownership / complaint / older turns with no sub-reason are never closed', () => {
    for (const subReason of ['safety', 'ownership', 'complaint', 'opt_out', null, undefined]) {
      assert.equal(turn({ subReason }), false, String(subReason))
    }
  })

  it('Verifier #2: holding lines, payment / complaint / order hand-offs, outages are never closed', () => {
    assert.equal(turn({ text: SAFE_LINE.review }), false)
    assert.equal(turn({ text: SAFE_LINE.payment }), false)
    assert.equal(turn({ text: SAFE_LINE.paymentSoon }), false)
    assert.equal(turn({ text: '¡Hola! Soy Andrés de ForgeCR 😊 Dame un momento y te confirmo 😊' }), false)
    assert.equal(turn({ text: 'Gracias por escribir 😊 A esta hora el equipo…' }), false)
    assert.equal(turn({ fallbackUsed: true }), false)
    assert.equal(turn({ intent: 'outage_ack' }), false)
    for (const reason of ['payment', 'payment_details', 'complaint', 'order_ready', 'human_request', 'review', null]) {
      assert.equal(turn({ reason }), false, String(reason))
    }
  })

  it('the stamp is tenant-scoped and never covers a customer message newer than the hand-off', () => {
    const src = read('src/lib/chat-unanswered-server.ts')
    const fn = src.slice(src.indexOf('export async function clearOpenHandoffOnResume'))
    assert.match(fn, /CROSS JOIN LATERAL \$\{LATEST_REAL_TURN_SQL\}/)
    assert.match(fn, /"tenantId" = \$\{input\.tenantId\}/)
    assert.match(fn, /"aiMode" = 'ai_active'/)
    assert.match(fn, /"lastMessageDirection" = 'outbound'/)
    assert.match(fn, /COALESCE\("lastInboundAt", "lastMessageAt"\) <= \$\{since\}::timestamp\(3\)/)
    assert.match(fn, /resumeClearsHandoff\(/)
  })

  it('the control route clears only when the sweep found our message last (uncached line check), audited; the inbox drops the badge', () => {
    const route = read('src/app/api/chat/soft-ai/control/route.ts')
    assert.match(route, /action === 'resume' && keyParts && !answering && sweepReason === 'answered'/)
    assert.match(route, /logAuditEvent\(\{/)
    assert.match(read('src/components/chats/SoftCopilotInboxV2.tsx'), /parsed\.data\.handoffCleared/)
  })
})
