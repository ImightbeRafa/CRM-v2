/**
 * PatchHouse v53 tests (2026-10-18) — code fixes 1, 2 and 6 from the exam / mystery-shopper / silent-trial report,
 * hardened after Verifier + SecureDog round 1. Pure functions + source asserts (no DB, no model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPaymentHandoffReason, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { hasConfirmationWording, hasOutboundConfirmationClaim, maskConditionalConfirmation } from '@/lib/soft-ai/shortcuts'
import { validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { isAttendRequest, isOptOutText } from '@/lib/soft-ai/llm/safety-router'
import { isReactionMessage } from '@/lib/soft-ai/inbound-hook'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import { planBurstInbound, unansweredBurst, type BurstMessage } from '@/lib/soft-ai/inbound-burst'
import { decideBurstTurn } from '@/lib/soft-ai/burst-decision'

const read = (p: string) => readFileSync(p, 'utf8')
const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({ ...row, id: `s-${index}`, isActive: true, sortOrder: index }))
const facts = parseBrandFacts({ schemaVersion: 1 })
/** Every claim check the live reply goes through, with and without a payment conversation. */
const claimReasons = (text: string, paymentContext = false) =>
  validateAgentOutput({ text, citedToolNames: [], paymentContext, customerText: paymentContext ? 'sinpe' : undefined }).reasons.filter(
    (r) => r === 'confirmation_wording' || r === 'payment_status_claim',
  )

describe('1 · the payment line only for payment hand-offs', () => {
  it('a non-payment hand-off whose text cannot go out gets the neutral line', () => {
    for (const reason of ['escalate', 'unknown_answer', 'human_request', 'owner_reply']) {
      const p = planModelTurnDelivery({ text: '', textOk: false, llmHandoff: { kind: 'handoff', reason } })
      assert.equal(p.text, SAFE_LINE.review, reason)
      assert.deepEqual(p.handoff, { kind: 'handoff', reason }, 'the hand-off itself is unchanged')
    }
  })
  it('payment hand-offs keep the fixed payment line', () => {
    assert.equal(planModelTurnDelivery({ text: 'Ya quedó pagado', textOk: true, llmHandoff: { kind: 'handoff', reason: 'payment' }, llmEscalateReason: 'payment_or_sinpe' }).text, SAFE_LINE.payment)
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, llmEscalateReason: 'payment_claim' }).text, SAFE_LINE.payment)
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, receiptCue: true }).text, SAFE_LINE.payment)
    for (const reason of ['payment', 'complaint']) {
      assert.equal(planModelTurnDelivery({ text: '', textOk: false, llmHandoff: { kind: 'handoff', reason } }).text, SAFE_LINE.payment, reason)
    }
    assert.equal(isPaymentHandoffReason('payment'), true)
    assert.equal(isPaymentHandoffReason('complaint'), true)
    assert.equal(isPaymentHandoffReason('escalate'), false)
    assert.equal(isPaymentHandoffReason(null), false)
  })
  it('a usable non-payment hand-off text still goes out as written', () => {
    const p = planModelTurnDelivery({ text: 'Claro 😊 ya te escribe alguien de la tienda.', textOk: true, llmHandoff: { kind: 'handoff', reason: 'human_request' } })
    assert.equal(p.text, 'Claro 😊 ya te escribe alguien de la tienda.')
  })
})

describe('2 · a conditional next-step participle is not a confirmation claim', () => {
  // Blocked at the base (the bare participle), allowed now — with or without a payment conversation.
  const nowAllowed = [
    'Si pagás antes de las 5 p. m., una vez confirmado el pago sale ese mismo día hábil 📦',
    'Una vez recibido el comprobante, se prepara tu pedido.',
    'Después de verificado el pago, sale en 2 a 5 días hábiles.',
    'Luego de confirmado tu pago, te enviaremos el número de guía.',
    'Una vez recibido el comprobante, vamos a preparar tu pedido 😊',
    'Una vez confirmado el pago, te llega en 2 a 5 días hábiles.',
  ]
  for (const t of nowAllowed) {
    it(`allows: ${t}`, () => {
      assert.equal(hasConfirmationWording(t), true, 'the strict regex still sees the participle')
      assert.equal(hasOutboundConfirmationClaim(t), false)
      assert.deepEqual(claimReasons(t), [])
      assert.deepEqual(claimReasons(t, true), [], 'also in a payment conversation (payment-status check)')
    })
  }
  // Every real claim stays blocked — including each bypass Verifier / SecureDog round 1 found.
  const blocked = [
    'Pago confirmado ✅',
    'Ya quedó tu pedido 😊',
    'Te confirmo que tu pago llegó bien.',
    'Tu pago está confirmado.',
    'Una vez confirmado el pago, ya quedó tu pedido.',
    'Después de verificado tu pago, ya salió tu pedido 📦',
    'Luego de verificado el pago, ya agendamos tu envío para hoy 🚚',
    'Una vez confirmado tu pago, tu pedido salió hoy.',
    'Despues de confirmado tu pago, salio tu pedido hoy',
    'Una vez\nconfirmado\nel pago, listo, ya va en camino',
    'UNA VEZ CONFIRMADO EL PAGO, YA SALIÓ TU PEDIDO',
    'Una vez confirmado el pago aplicado, te aviso',
    'El equipo te confirma tu pedido ya va en camino',
    'El equipo te confirma tu pedido ya va en proceso de envío',
    '¡Listo! Apenas verificado tu SINPE, ya sale',
    '¡Listo! Apenas recibido tu pago',
    'El equipo confirma tu pedido: pago recibido',
    // Verifier round 2: claim before the participle, perfect / passive / estar tails, present confirmation, next sentence.
    'Tu pedido ya salió, una vez verificado tu pago.',
    'Ya salió tu pedido 📦 luego de confirmado el pago',
    'Tu pedido salió hoy, una vez confirmado el pago.',
    'Una vez confirmado tu pago, hemos despachado tu pedido 📦',
    'Una vez verificado tu pago, te hemos enviado la guía de Correos.',
    'Una vez confirmado el pago, tu pedido ha sido enviado.',
    'Una vez confirmado el pago, tu pedido está despachado',
    'Una vez recibido tu comprobante, te confirmo que todo está bien 😊',
    'Una vez confirmado tu pago, preparamos el pedido. Salió hoy con Correos 📦',
    'Una vez confirmado tu pago, tu pedido se despacho hoy',
    'Una vez confirmado el pago, ya sale ese mismo día 📦',
    // Present = preterite in Spanish ("enviamos" = "we sent"): never excused.
    'Una vez recibido el comprobante, enviamos tu pedido.',
    'Luego de confirmado tu pago, te enviamos el número de guía.',
    'Una vez verificado el pago, despachamos tu pedido por Correos.',
    // Verifier round 3: a done claim in the next sentence vetoes the mask.
    'Una vez confirmado tu pago, se despacha hoy mismo. Tu pedido está en ruta 🚚',
    'Una vez confirmado tu pago, sale hoy mismo. Tu guía es CR123456789CR',
    'Una vez confirmado el pago, vamos a enviar tu pedido. Fuimos a Correos hoy',
    // SecureDog round 3 (informational, hardened): -aron / -ieron / first-person -é, invisible characters.
    'Una vez confirmado el pago, sale ese mismo día. Lo despacharon.',
    'Una vez confirmado el pago, sale ese mismo día. Te envié la guía.',
    'Una vez confirmado el pago, sale ese mismo día. Ya​ salió.',
  ]
  for (const t of blocked) {
    it(`still blocks: ${JSON.stringify(t)}`, () => {
      assert.ok(claimReasons(t).length > 0, 'blocked without payment context')
      assert.ok(claimReasons(t, true).length > 0, 'blocked in a payment conversation')
    })
  }
  it('only the participle of an allow-listed next-step sentence is masked, never anything else', () => {
    assert.equal(maskConditionalConfirmation('Una vez confirmado el pago, sale ese mismo día hábil'), 'Una vez ·········· el pago, sale ese mismo día hábil')
    assert.equal(maskConditionalConfirmation('Una vez confirmado el pago, ya salió'), 'Una vez confirmado el pago, ya salió')
    assert.equal(maskConditionalConfirmation('Una vez confirmado el pago, sale hoy'), 'Una vez confirmado el pago, sale hoy', '"hoy" alone is not on the list')
    assert.equal(maskConditionalConfirmation('Apenas confirmado el pago, sale ese mismo día'), 'Apenas confirmado el pago, sale ese mismo día', '"apenas" also means "just" in CR')
    // One allowed sentence never excuses another sentence of the same reply.
    const two = 'Una vez confirmado el pago, sale ese mismo día. Pago confirmado ✅'
    assert.equal(maskConditionalConfirmation(two), 'Una vez ·········· el pago, sale ese mismo día. Pago confirmado ✅')
    assert.equal(hasOutboundConfirmationClaim(two), true)
  })
  it('the new patterns stay linear on long adversarial input (ReDoS)', () => {
    const long = `una vez confirmado el pago, sale${' ese mismo día'.repeat(4000)} x`
    const attend = `hola ${'buenas '.repeat(4000)}¿me atiende alguien${' 🙏'.repeat(4000)} x`
    const t0 = Date.now()
    maskConditionalConfirmation(long)
    isAttendRequest(attend)
    isAttendRequest(' '.repeat(50_000) + 'x')
    // SecureDog R2-1 / Verifier N1: a run of spaces AFTER the request (was 13–35 s at 4 000 spaces).
    isAttendRequest(`me atiende alguien${' '.repeat(4000)}x`)
    isAttendRequest(`hola hola${' '.repeat(4000)}x`)
    maskConditionalConfirmation(`una vez confirmado el pago,${' '.repeat(20_000)}x sale`)
    assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`)
  })
  it('CONFIRMATION_WORDING_RE is unchanged; owner texts keep the strict check; live, Probar and the canary share the rule', () => {
    assert.equal(hasConfirmationWording('una vez confirmado el pago'), true)
    assert.match(read('src/lib/soft-ai/after-hours-note.ts'), /hasConfirmationWording\(text\)/)
    assert.match(read('src/lib/soft-ai/shortcut-import.ts'), /hasConfirmationWording\(trimmed\)/)
    const v = read('src/lib/soft-ai/llm/output-validator.ts')
    assert.match(v, /const claimText = maskConditionalConfirmation\(text\)/)
    assert.match(v, /ALWAYS_PAYMENT_STATUS_REPLY_RE\.test\(claimText\)/)
    assert.match(v, /PAYMENT_STATUS_REPLY_RE\.test\(claimText\)/)
    assert.match(read('src/lib/soft-ai/probar-scenarios.ts'), /if \(hasOutboundConfirmationClaim\(reply\)\) failures\.push/)
    assert.match(read('src/lib/soft-ai/agent-replay.ts'), /if \(hasOutboundConfirmationClaim\(input\.text\)\) return \{ ok: false, reason: 'confirmation' \}/)
  })
})

describe('6 · reactions get no turn; a whole-message "me atiende alguien" reaches a person', () => {
  it('a reaction is decided by its TYPE, in the webhook hook and in the waiting sweep', () => {
    assert.equal(isReactionMessage('reaction'), true)
    assert.equal(isReactionMessage('text'), false, 'a typed "[reaction]" is a real message')
    assert.equal(isReactionMessage('image'), false)
    assert.equal(isReactionMessage(null), false)
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    const enqueue = hook.slice(hook.indexOf('export async function enqueueSoftAiAfterInbound'))
    const skip = enqueue.indexOf("if (isReactionMessage(args.messageType)) return { skippedReason: 'reaction' }")
    assert.ok(skip > 0 && skip < enqueue.indexOf('persistJob('))
    assert.match(read('src/app/api/chat/webhook/route.ts'), /messageType: result\.messageType,/)
    // The sweep never treats a reaction as the customer's waiting message (else it re-created the job ~90 s later).
    const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
    assert.match(sweep, /messageType: true,/)
    assert.match(sweep, /waitingAck !== true && r\.messageType !== 'reaction'/)
  })
  const person = [
    'Me atiende alguien por favor?',
    '¿Alguien me atiende?',
    'me puede atender una persona?',
    '¿Me pueden atender un asesor?',
    'quiero que alguien me atienda',
    'Hola, ¿me atiende una persona?',
    'Buenas noches ¿me atiende alguien porfa?',
    // Verifier round 2
    '¿Me atiende alguien? 🙏',
    'Hola buenas, ¿me atiende alguien?',
    'Disculpe, ¿me atiende alguien?',
    'Hola\n¿me atiende alguien?',
    'Quiero que me atienda alguien',
    '¿Me atiende alguien? 🙏🏻', // skin-tone modifier (Verifier round 4)
  ]
  for (const t of person) {
    it(`person request: ${t}`, () => {
      assert.equal(isAttendRequest(t), true)
      const d = decideInbound({ inboundText: t, messageType: 'text', brandFacts: facts, shortcuts })
      assert.equal(d.shortcutKey, 'sys_handoff_optout')
      assert.deepEqual(d.handoff, { kind: 'handoff', reason: 'human_request' })
    })
  }
  const notPerson = [
    '¿A qué hora atienden?',
    '¿Atienden los domingos?',
    'Me atendieron muy bien, gracias',
    '¿me atiende alguien en la tienda de San Pedro para retirar?',
    '¿En la tienda me atiende alguien los domingos?',
    'Si llego a las 5, ¿me atiende alguien?',
    '¿Alguien me puede atender el sábado en la tienda para retirar?',
    'No hace falta que me atienda una persona, ¿cuánto cuesta el Focus?',
    'no necesito que me atienda alguien, solo quiero el precio',
    'No quiero que me atienda una persona, prefiero que me sigas ayudando vos',
    'Siempre hay una persona que me atiende muy bien',
  ]
  for (const t of notPerson) {
    it(`stays with the agent: ${t}`, () => {
      assert.equal(isAttendRequest(t), false)
      const d = decideInbound({ inboundText: t, messageType: 'text', brandFacts: facts, shortcuts })
      assert.notEqual(d.shortcutKey, 'sys_handoff_optout')
    })
  }
  it('SecureDog #2: a receipt captioned "¿me atiende alguien?" keeps the receipt / payment path', () => {
    // A photo caption never goes through the attend rule.
    const caption = decideInbound({ inboundText: 'Ya pagué, ¿me atiende alguien?', messageType: 'image', brandFacts: facts, shortcuts, awaitingReceipt: true })
    assert.equal(caption.shortcutKey, 'sys_handoff_media')
    assert.equal(caption.handoff?.reason, 'payment')
    const onlyAttend = decideInbound({ inboundText: '¿me atiende alguien?', messageType: 'image', brandFacts: facts, shortcuts, awaitingReceipt: true })
    assert.equal(onlyAttend.handoff?.reason, 'payment')
    // Burst: "Ya hice el SINPE" + "¿me atiende alguien?" → the payment hand-off wins (receipt alert, "Pago por verificar").
    const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 15, 0, s)).toISOString()
    const history = [{ id: 'm1', direction: 'inbound' as const, content: 'Ya hice el SINPE', messageType: 'text', sentAt: at(0) }]
    const trigger = { content: '¿me atiende alguien?', messageType: 'text', sentAt: at(3) }
    const earlier = unansweredBurst(history as BurstMessage[], trigger)
    const burst = planBurstInbound({ trigger, earlier, awaitingReceipt: () => false })
    const { decision } = decideBurstTurn({ burst, burstEarlier: earlier, trigger, history, mediaSalesContext: null, earlierCustomerTexts: [], decisionBase: { brandFacts: facts, shortcuts, awaitingPaymentMethod: false } })
    assert.equal(decision.handoff?.kind, 'handoff')
    assert.equal(decision.handoff?.reason, 'payment')
  })
  it('the attend rule never widens the caption / burst opt-out (isOptOutText)', () => {
    assert.equal(isOptOutText('Me atiende alguien por favor?'), false)
    assert.equal(isOptOutText('quiero hablar con una persona'), true)
  })
})
