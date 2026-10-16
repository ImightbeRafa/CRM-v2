/**
 * Rafael 2026-10-16: when the agent does not have an answer ("El detalle exacto de esa mezcla no lo tengo acá. Lo
 * confirmo y te lo paso.") a person must get the chat — never a promise nobody keeps while the agent keeps selling.
 * Verifier round 1 inputs included (missed phrasings, false positives that would take a selling chat away). Pure.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/agents2-unknown-answer.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  admitsCannotAnswer,
  cutAfterCannotAnswer,
  planModelTurnDelivery,
  HANDOFF_REASON,
  SAFE_LINE,
} from '@/lib/soft-ai/agent-turn-outcome'
import { HANDOFF_REASON_LABELS, handoffNotificationText } from '@/lib/workspace-notifications'
import { normalizeHandoffReason } from '@/lib/soft-ai/handoff-notify'
import { afterHoursHandoffKind, applyAfterHoursText } from '@/lib/soft-ai/business-hours'
import { caseWhy, probarOutcomeCodes } from '@/lib/soft-ai/test-engine/why'
import { probarWhy } from '@/lib/soft-ai/probar-why'
import { evaluateStep } from '@/lib/soft-ai/probar-scenarios'
import { SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'

/** The live PatchHouse reply (2026-10-16 screenshot), as the agent wrote it. */
const LIVE =
  'Lo que sí te puedo decir es que lleva la mezcla calmante Stress Down y complejo B 😊\n\nEl detalle exacto de esa mezcla no lo tengo acá. Lo confirmo y te lo paso.\n\n¿Con eso te alcanza para decidir, o te lo llevás?'

describe('admitsCannotAnswer', () => {
  it('catches the live reply and the wordings the prompt teaches', () => {
    for (const t of [
      LIVE,
      'Es un suplemento de bienestar, no un medicamento. El detalle exacto de esa mezcla no lo tengo acá; lo confirmo y te lo paso.',
      'No tengo ese dato, dejame consultarlo 😊',
      'No cuento con esa información ahorita.',
      'Lo consulto y te aviso.',
      'Lo reviso y te confirmo 😊 ¿Te lo llevás?',
      'Lo pregunto y te digo. ¿Te lo llevás?',
      'Lo confirmo con el equipo y te aviso.',
      'Eso te lo confirmo en un ratito.',
      'La fórmula exacta no la tengo, voy a consultarlo.',
      // Verifier round 2: plural, "su / sus" (the product), "te los paso".
      'Los componentes exactos no los tengo acá. Los confirmo y te los paso. ¿Te lo llevás?',
      'Sus ingredientes exactos no los tengo acá 😊 Los confirmo y te los paso.',
      'No tengo el detalle de su composición, lo consulto y te aviso. ¿Te lo llevás?',
      'Los ingredientes exactos no los tengo a mano, te los confirmo en un rato. ¿Lo querés?',
      'Te confirmo en un ratito 😊',
      'Ese dato lo tengo que confirmar.',
      // Verifier round 4: the push after an emoji names the order / the customer — the promise still counts.
      'El detalle exacto no lo tengo acá, lo confirmo y te lo paso 😊 ¿Hacemos el pedido?',
      'Los componentes exactos no los tengo acá, los confirmo y te los paso 😊 ¿Lo querés con envío a tu casa?',
      'Lo consulto y te aviso 🙌 ¿Te paso los datos de pago?',
      'Lo consulto y te aviso 🙌 ¿Me pasás tu nombre y dirección para el envío?',
    ]) {
      assert.equal(admitsCannotAnswer(t), true, t)
    }
  })

  it('never fires on selling replies, the customer\'s own data, stock, totals or the code safe lines', () => {
    for (const t of [
      'Cada paquete de 30 parches sale en ₡9 900.',
      '¿Lo querés con envío a domicilio o retiro? ✨',
      'Sí, se puede usar todos los días: uno al día, el paquete trae 30 (un mes).',
      'Perfecto, enseguida lo revisamos 😊',
      'Dejame confirmar tu pedido: 2 parches Stress Relief, envío a Heredia. ¿Todo bien?',
      'Dejame verificar tu dirección: Oreamuno, Cartago.',
      'Aún no tengo el dato de tu provincia, ¿me lo pasás?',
      'No tengo el detalle de tu dirección completa, ¿me lo pasás?',
      '¿Me confirmás tu dirección? No la tengo a mano.',
      'Todavía no tengo la info para el envío, pasame:',
      'En talla M no la tengo acá, solo en L. ¿Te sirve?',
      'No sé exactamente cuánto tarda Correos, normalmente 2 a 3 días. ¿Te lo mando?',
      'Bueno lo tengo acá listo para enviarte hoy 😊',
      'Uno lo tengo acá y otro en bodega',
      'El de invierno lo tengo acá en tienda',
      'El total lo confirmo y te lo paso al preparar el pedido. ¿Me pasás tus datos?',
      SAFE_LINE.review,
      SAFE_LINE.payment,
      SAFE_LINE.paymentSoon,
      'Gracias, ya tengo tu nombre y teléfono 😊',
      // Verifier round 2: sales question, low stock, blends, the customer's address.
      'Dejame preguntar: ¿es para vos o para regalo?',
      'Esa cantidad no la tengo ahorita, me quedan 6. ¿Te sirven?',
      'La mezcla de lavanda no la tengo, pero la de menta sí. ¿Te sirve?',
      'Perfecto, la reviso y te digo si la dirección está completa.',
      // Verifier round 3: asking the customer for their own data, "Te confirmo en un momento cuál…".
      'Todavía no tengo ese dato, ¿me lo pasás?',
      '¡Claro! No tengo ese dato todavía, ¿me pasás tu dirección?',
      'Esa info no la tengo acá, ¿me la pasás?',
      'Esos datos no los tengo a mano, ¿me los pasás de nuevo?',
      'Ese dato no lo tengo acá: ¿en qué provincia estás?',
      'Te confirmo en un momento cuál te conviene: ¿lo querés para dormir o para el estrés?',
    ]) {
      assert.equal(admitsCannotAnswer(t), false, t)
    }
  })
})

describe('cutAfterCannotAnswer', () => {
  it('keeps everything the agent knew; drops only the questions after the promise', () => {
    assert.equal(
      cutAfterCannotAnswer(LIVE),
      'Lo que sí te puedo decir es que lleva la mezcla calmante Stress Down y complejo B 😊\n\nEl detalle exacto de esa mezcla no lo tengo acá. Lo confirmo y te lo paso.',
    )
    assert.equal(cutAfterCannotAnswer('Lo consulto y te aviso 😊\n¿Te lo llevás?'), 'Lo consulto y te aviso 😊')
    assert.equal(cutAfterCannotAnswer('Hola'), 'Hola')
    // An emoji before the push no longer hides it (verifier round 2).
    assert.equal(
      cutAfterCannotAnswer('El detalle exacto de esa mezcla no lo tengo acá, lo confirmo y te lo paso 😊 ¿Con eso te alcanza para decidir, o te lo llevás?'),
      'El detalle exacto de esa mezcla no lo tengo acá, lo confirmo y te lo paso 😊',
    )
    assert.equal(cutAfterCannotAnswer('Esa fórmula no la tengo detallada, lo consulto y te aviso 😊 ¿Te lo aparto?'), 'Esa fórmula no la tengo detallada, lo consulto y te aviso 😊')
    // No dangling comma / lead-in left behind (round 3).
    assert.equal(cutAfterCannotAnswer('Lo confirmo y te lo paso, ¿te parece? Mientras tanto, ¿querés pedirlo?'), 'Lo confirmo y te lo paso.')
    assert.equal(cutAfterCannotAnswer('Lo confirmo y te lo paso, ¿te parece?'), 'Lo confirmo y te lo paso.')
  })

  it('never drops a list, a payment block or the fixed data list', () => {
    const list = 'No tengo el detalle exacto, pero lleva:\n- Lavanda\n- Magnesio\n\n¿Te lo llevás?'
    assert.equal(cutAfterCannotAnswer(list), 'No tengo el detalle exacto, pero lleva:\n- Lavanda\n- Magnesio')
    const pay = 'La fórmula exacta no la tengo, lo consulto y te aviso.\nPara pagar por SINPE:\nSINPE Móvil 6201 9914'
    assert.equal(cutAfterCannotAnswer(pay), pay)
    const data = `Esa mezcla no la tengo detallada. Lo reviso y te confirmo.\n\nPara armar tu pedido pasame:\n${SHIPPING_DATA_LIST}`
    assert.equal(cutAfterCannotAnswer(data), data)
  })
})

describe('planModelTurnDelivery — no answer → a person', () => {
  it('the live reply goes out without the push and the chat is handed off (unknown_answer)', () => {
    const plan = planModelTurnDelivery({ text: LIVE, textOk: true, llmHandoff: null })
    assert.equal(plan.handoff?.kind, 'handoff')
    assert.equal(plan.handoff?.reason, HANDOFF_REASON.unknownAnswer)
    assert.doesNotMatch(plan.text, /te lo llevás/)
    assert.match(plan.text, /Stress Down y complejo B/)
  })

  it('the model also called escalate_to_human: same trimmed text, its hand-off kept', () => {
    const plan = planModelTurnDelivery({ text: LIVE, textOk: true, llmHandoff: { kind: 'handoff', reason: HANDOFF_REASON.modelAsked } })
    assert.equal(plan.handoff?.reason, HANDOFF_REASON.modelAsked)
    assert.doesNotMatch(plan.text, /te lo llevás/)
  })

  it('payment rules still win (receipt, payment claim, payment data sent by the team)', () => {
    assert.equal(planModelTurnDelivery({ text: LIVE, textOk: true, llmHandoff: null, receiptCue: true }).text, SAFE_LINE.payment)
    assert.equal(planModelTurnDelivery({ text: LIVE, textOk: true, llmHandoff: null, llmEscalateReason: 'payment_claim' }).text, SAFE_LINE.payment)
    assert.equal(planModelTurnDelivery({ text: LIVE, textOk: true, llmHandoff: null, paymentDataByTeam: true }).handoff?.reason, HANDOFF_REASON.paymentData)
  })

  it('a reply that failed a check is still the safe line; a normal reply is untouched', () => {
    assert.equal(planModelTurnDelivery({ text: LIVE, textOk: false, llmHandoff: null }).text, SAFE_LINE.review)
    assert.equal(planModelTurnDelivery({ text: 'Dejame confirmar tu pedido: 2 parches. ¿Todo bien?', textOk: true, llmHandoff: null }).handoff, null)
  })
})

describe('after hours, team alert, test chat', () => {
  it('after hours the answer stays and the team line is added', () => {
    assert.equal(afterHoursHandoffKind('unknown_answer'), 'person')
    const text = applyAfterHoursText(
      { text: 'Esa mezcla no la tengo detallada. Lo reviso y te confirmo.', handoff: { kind: 'handoff', reason: 'unknown_answer' } },
      { afterHours: true, label: 'mañana a las 9:00 a. m.', transparent: false, note: null } as never,
      { safeReview: SAFE_LINE.review, paymentSoon: SAFE_LINE.paymentSoon } as never,
    )
    assert.match(text, /^Esa mezcla no la tengo detallada\. Lo reviso y te confirmo\.\n/)
    assert.match(text, /mañana a las 9:00/)
  })

  it('the team sees a plain reason', () => {
    assert.equal(HANDOFF_REASON_LABELS.unknown_answer, 'La IA no tenía la respuesta — contestale vos')
    assert.equal(normalizeHandoffReason('unknown_answer', 'handoff'), 'unknown_answer')
    assert.equal(handoffNotificationText('ai_handoff:c1:m1:unknown_answer', '')?.snippet, 'La IA no tenía la respuesta — contestale vos')
  })

  it('the test chat and the quick check show it (never a silent shorter reply)', () => {
    const handoff = { kind: 'handoff' as const, reason: 'unknown_answer' }
    assert.ok(probarOutcomeCodes({ handoff }).includes('unknown_answer'))
    assert.match(caseWhy(['unknown_answer']) ?? '', /No tenía la respuesta/)
    assert.ok(probarWhy({ toolTrace: [], handoffReason: 'unknown_answer' }).includes('pasó a una persona: no tenía la respuesta'))
    assert.equal(evaluateStep({ text: 'Lleva NAC.', handoff } as never, { handoff: false }).pass, false)
  })

  it('the prompts send missing store facts to a person instead of "lo confirmo"', () => {
    const prompt = readFileSync('src/lib/soft-ai/llm/prompt.ts', 'utf8')
    assert.match(prompt, /Si te falta un dato DE LA TIENDA o del producto/)
    assert.match(prompt, /llamá escalate_to_human\(other\) y no sigas vendiendo/)
    assert.doesNotMatch(prompt, /escalate_to_human es solo para pagos/)
    const state = readFileSync('src/lib/soft-ai/sales-state.ts', 'utf8')
    assert.match(state, /decí con naturalidad que lo revisás y le confirmás, llamá escalate_to_human\(other\)/)
  })
})
