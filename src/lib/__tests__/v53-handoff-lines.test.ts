/**
 * PatchHouse v53 tests (2026-10-18) — code fixes 1, 2 and 6 from the exam / mystery-shopper / silent-trial report.
 * Pure functions + source asserts (no DB, no model calls).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPaymentHandoffReason, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { hasConfirmationWording, hasOutboundConfirmationClaim, withoutConditionalConfirmation } from '@/lib/soft-ai/shortcuts'
import { validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { isOptOutText } from '@/lib/soft-ai/llm/safety-router'
import { isReactionOnly } from '@/lib/soft-ai/inbound-hook'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'

const read = (p: string) => readFileSync(p, 'utf8')
const shortcuts: RuntimeShortcut[] = RESERVED_SHORTCUT_SEEDS.map((row, index) => ({ ...row, id: `s-${index}`, isActive: true, sortOrder: index }))
const facts = parseBrandFacts({ schemaVersion: 1 })

describe('1 · the payment line only for payment hand-offs', () => {
  it('a non-payment hand-off whose text cannot go out gets the neutral line', () => {
    for (const reason of ['escalate', 'unknown_answer', 'human_request', 'owner_reply']) {
      const p = planModelTurnDelivery({ text: '', textOk: false, llmHandoff: { kind: 'handoff', reason } })
      assert.equal(p.text, SAFE_LINE.review, reason)
      assert.notEqual(p.text, SAFE_LINE.payment, reason)
      assert.deepEqual(p.handoff, { kind: 'handoff', reason }, 'the hand-off itself is unchanged')
    }
  })
  it('payment hand-offs keep the fixed payment line', () => {
    // The model escalated about a payment: always the fixed line, even with a usable text (INT-93).
    assert.equal(planModelTurnDelivery({ text: 'Ya quedó pagado', textOk: true, llmHandoff: { kind: 'handoff', reason: 'payment' }, llmEscalateReason: 'payment_or_sinpe' }).text, SAFE_LINE.payment)
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, llmEscalateReason: 'payment_claim' }).text, SAFE_LINE.payment)
    // A money hand-off reason (payment / refund complaint) with an unusable text: the payment line.
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

describe('2 · conditional "next step" phrases are not confirmation claims', () => {
  const allowed = [
    'Si pagás antes de las 5 p. m., una vez confirmado el pago sale ese mismo día hábil 📦',
    'Una vez recibido el comprobante, preparamos tu pedido.',
    'Apenas recibamos el comprobante te lo enviamos 😊',
    'Cuando se confirme tu pago, el pedido sale lo antes posible.',
    'Cuando confirmemos el pago te aviso por aquí.',
    'Mandame el comprobante y el equipo confirma tu pedido 😊',
    'Después de verificado el pago, sale en 2 a 5 días hábiles.',
  ]
  for (const t of allowed) {
    it(`allows: ${t}`, () => {
      assert.equal(hasOutboundConfirmationClaim(t), false)
      assert.ok(!validateAgentOutput({ text: t, citedToolNames: [] }).reasons.includes('confirmation_wording'))
    })
  }
  const blocked = [
    'Pago confirmado ✅',
    'Ya quedó tu pedido 😊',
    'Te confirmo que tu pago llegó bien.',
    'Recibimos tu pago, gracias.',
    'Tu pago está confirmado.',
    'Una vez confirmado el pago, ya quedó tu pedido.',
    'Cuando confirmemos el pago te aviso. Pago recibido 🙌',
    'Ya te lo enviamos.',
  ]
  for (const t of blocked) {
    it(`still blocks: ${t}`, () => {
      assert.equal(hasOutboundConfirmationClaim(t), true)
      assert.ok(validateAgentOutput({ text: t, citedToolNames: [] }).reasons.includes('confirmation_wording'))
    })
  }
  it('the claim regex itself is unchanged (INT-70 / INT-93): the bare word still trips it', () => {
    assert.equal(hasConfirmationWording('una vez confirmado el pago'), true)
    assert.equal(withoutConditionalConfirmation('una vez confirmado el pago, sale hoy').includes('confirmado'), false)
    // Owner-written texts (saved replies, after-hours note, import) keep the strict check.
    assert.match(read('src/lib/soft-ai/after-hours-note.ts'), /hasConfirmationWording\(text\)/)
    assert.match(read('src/lib/soft-ai/shortcut-import.ts'), /hasConfirmationWording\(trimmed\)/)
    // The live output check and Probar's own check use the same rule.
    assert.match(read('src/lib/soft-ai/llm/output-validator.ts'), /if \(hasOutboundConfirmationClaim\(text\)\) reasons\.push\('confirmation_wording'\)/)
    assert.match(read('src/lib/soft-ai/probar-scenarios.ts'), /if \(hasOutboundConfirmationClaim\(reply\)\) failures\.push/)
  })
})

describe('6 · reactions get no turn; "me atiende alguien" reaches a person', () => {
  it('a reaction bubble is skipped before any job is written', () => {
    assert.equal(isReactionOnly('[reaction]'), true)
    assert.equal(isReactionOnly(' [Reaction] '), true)
    assert.equal(isReactionOnly('[reaction] hola'), false)
    assert.equal(isReactionOnly('hola'), false)
    const hook = read('src/lib/soft-ai/inbound-hook.ts')
    const enqueue = hook.slice(hook.indexOf('export async function enqueueSoftAiAfterInbound'))
    const skip = enqueue.indexOf("if (isReactionOnly(args.content)) return { skippedReason: 'reaction' }")
    assert.ok(skip > 0 && skip < enqueue.indexOf('persistJob('))
  })
  const person = ['Me atiende alguien por favor?', '¿Alguien me atiende?', 'me puede atender una persona?', '¿Me pueden atender un asesor?', 'quiero que alguien me atienda', 'Hola, ¿me atiende una persona?']
  for (const t of person) {
    it(`person request: ${t}`, () => {
      assert.equal(isOptOutText(t), true)
      const d = decideInbound({ inboundText: t, messageType: 'text', brandFacts: facts, shortcuts })
      assert.equal(d.shortcutKey, 'sys_handoff_optout')
      assert.deepEqual(d.handoff, { kind: 'handoff', reason: 'human_request' })
    })
  }
  const notPerson = ['¿A qué hora atienden?', '¿Atienden los domingos?', 'Me atendieron muy bien, gracias', '¿Alguien me puede decir el precio?', 'me atiende la tienda en San Pedro?']
  for (const t of notPerson) {
    it(`stays with the agent: ${t}`, () => {
      assert.equal(isOptOutText(t), false)
    })
  }
})
