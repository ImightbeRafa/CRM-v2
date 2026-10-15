/**
 * Agentes IA 2.0 Phase 1 — SecureDog release review 2026-10-15 regressions (INT-93..99, MEDIA-14).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText } from '@/lib/soft-ai/payment-classifier'
import { validateAgentOutput, shortenToMaxLines } from '@/lib/soft-ai/llm/output-validator'
import { planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { modelHandoff } from '@/lib/soft-ai/llm/runtime'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { PERIODIC_REARM_SKIP_REASONS } from '@/lib/soft-ai/waiting-sweep'

const read = (p: string) => readFileSync(p, 'utf8')

describe('INT-93: payment claims never reach a confirming reply', () => {
  it('questions about the state of a payment stay with a person (classifier)', () => {
    for (const t of [
      '¿Se acreditó el pago?',
      '¿El pago se aplicó?',
      '¿Se procesó mi pago?',
      '¿Mi sinpe es válido?',
      '¿Hay algún problema con mi pago?',
      'hola, ¿es normal que el sinpe no aparezca todavía?',
      '¿Es este el número para el sinpe? Ya lo envié',
      'Confirmame que lo recibieron porfa',
      'Me confirman cuando les entre',
      '¿me confirmás?',
      'Revisen porfa',
    ]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('a short "yes it arrived" reply to a payment message is blocked as payment_status_claim', () => {
    for (const reply of ['Sí, ya se acreditó 😊', 'Sí, ya nos llegó', 'Sí, lo recibimos', 'Todo en orden con tu sinpe', 'Sí, el pago es correcto', 'Ya lo vimos, todo bien', 'Sí, se aplicó correctamente']) {
      const v = validateAgentOutput({ text: reply, citedToolNames: [], customerText: '¿Se acreditó el pago?' })
      assert.ok(v.reasons.includes('payment_status_claim'), reply)
    }
    // Delivery wording to a payment-method question is fine.
    assert.ok(!validateAgentOutput({ text: 'Aceptamos tarjeta en la web 😊 Te llega en 2 a 4 días', citedToolNames: [], customerText: '¿Aceptan tarjeta para el pago?' }).reasons.includes('payment_status_claim'))
    // No payment word in the customer message → not checked.
    assert.ok(!validateAgentOutput({ text: 'Sí, lo recibimos ayer en bodega', citedToolNames: [], customerText: '¿tienen stock?' }).reasons.includes('payment_status_claim'))
  })
  it('a payment-sounding reply is a real PAYMENT hand-off: fixed text, chat goes to a person', () => {
    assert.deepEqual(modelHandoff('payment_claim', '¿Se acreditó el pago?').kind, 'handoff')
    const plan = planModelTurnDelivery({
      text: 'Sí, ya se acreditó 😊',
      textOk: false,
      llmHandoff: modelHandoff('payment_claim', '¿Se acreditó el pago?'),
      llmEscalateReason: 'payment_claim',
      paymentDataByTeam: true,
    } as never)
    assert.equal(plan.text, SAFE_LINE.payment)
    assert.equal(plan.handoff?.kind, 'handoff')
    const runtime = read('src/lib/soft-ai/llm/runtime.ts')
    assert.match(runtime, /validation\.reasons\.includes\('confirmation_wording'\)/)
    assert.match(runtime, /validation\.reasons\.includes\('payment_status_claim'\)/)
    assert.match(runtime, /structured\.needsHuman && hasPaymentWord\(input\.inboundText/)
    assert.match(runtime, /customerText: input\.inboundText/)
  })
  it('a media caption with a confirm/review verb is a receipt', () => {
    const d = decideInbound({ inboundText: 'revisen porfa', messageType: 'image', brandFacts: { schemaVersion: 1 }, shortcuts: RESERVED_SHORTCUT_SEEDS.map((s) => ({ ...s, isActive: true, sortOrder: 0 })) } as never)
    assert.equal(d.escalate, true)
    assert.equal(d.shortcutKey, 'sys_handoff_media')
  })
})

describe('INT-94: multi-unit totals are never quotable', () => {
  it('the allowlist wiring has no quantity totals', () => {
    assert.doesNotMatch(read('src/lib/soft-ai/agent-turn-inputs.ts'), /salesQuantityAmounts\(/)
  })
})

describe('MEDIA-14: a media caption asking for a person is an opt-out', () => {
  it('opt-out wins over "¿Me contás por escrito?"', () => {
    for (const caption of ['quiero hablar con una persona', 'STOP', 'no quiero un bot']) {
      const d = decideInbound({ inboundText: caption, messageType: 'image', brandFacts: { schemaVersion: 1 }, shortcuts: RESERVED_SHORTCUT_SEEDS.map((s) => ({ ...s, isActive: true, sortOrder: 0 })) } as never)
      assert.equal(d.shortcutKey, 'sys_handoff_optout', caption)
      assert.equal(d.escalate, true, caption)
    }
  })
})

describe('INT-95..99 hardening', () => {
  it('INT-95: OFF voids a passing check; activation re-checks before and after its write', () => {
    const src = read('src/lib/soft-ai/agent-activation.ts')
    assert.match(src, /recordRunActivation\(input\.tenantId, latest\.id, \{ ok: false, code: 'OFF' \}\)/)
    assert.equal(src.match(/runVoidedByOff\(run\.tenantId, run\.id\)/g)?.length, 2)
  })
  it('INT-96: Devolver a IA route is same-origin and rate-limited', () => {
    const src = read('src/app/api/chat/soft-ai/control/route.ts')
    assert.match(src, /isSameOriginRequest\(request\)/)
    assert.match(src, /controlRateLimit\(/)
  })
  it('INT-97: the chat-automation cron honours DISABLE_CRONS', () => {
    assert.match(read('src/app/api/cron/chat-automation/route.ts'), /if \(cronsDisabled\(process\.env\)\)/)
  })
  it('INT-98: the periodic sweep never re-answers kill-switch / AI-terms skips; only messages after the line was on', () => {
    assert.equal(PERIODIC_REARM_SKIP_REASONS.has('kill_switch'), false)
    assert.equal(PERIODIC_REARM_SKIP_REASONS.has('ai_terms_not_accepted'), false)
    assert.match(read('src/lib/soft-ai/waiting-sweep.ts'), /notBeforeMs: passedAt/)
  })
  it('INT-99: shortening never drops a qualifying line', () => {
    const long = 'Hola 😊\nEl Focus está en ₡9.900\nmás el envío de ₡3.000\nno incluye regalos\nlínea 5\nlínea 6\n¿Lo querés?'
    assert.equal(shortenToMaxLines(long, 3), long)
    const plain = 'Hola 😊\nSomos tienda en línea\nTe cuento\nCon gusto\nMuy bueno\n¿Te ayudo?'
    assert.ok(shortenToMaxLines(plain, 2).split('\n').length < plain.split('\n').length)
  })
})
