/**
 * SecureDog wave 2026-10-22 (lane D): INT-201 (invisible characters glued into the customer's LATEST message), INT-158 M1
 * (English / PT / FR payment state), the cheap M2 reply wordings, INT-202 (a bare "yes" behind markup / emoji), INT-205
 * (the sent, shortened text gets the payment context).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/securedog-wave-d.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText, hasPaymentWord, mentionsConfirmVerb } from '@/lib/soft-ai/payment-classifier'
import { validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'

const SEPARATORS = [0x200b, 0x2060, 0xad, 0xfeff, 0xe0020, 0x2028, 0x2029, 0x85, 0x0b, 0x1f, 0x200e, 0x200c, 0x200d, 0x180e, 0xa0, 0x3000].map(
  (c) => String.fromCodePoint(c),
)
const CLAIMS = ['ya pagué', 'ya le hice el sinpe', 'ahí va el comprobante', 'ya transferí', 'ya deposité', 'ya le hice el sinpe, ¿me confirmás?', '¿me confirmás?']
const CLAIM_REASONS = new Set(['payment_status_claim', 'confirmation_wording', 'write_claim'])
const held = (text: string, customerText: string, paymentContext = false) =>
  validateAgentOutput({ text, citedToolNames: [], modelText: true, customerText, paymentContext }).reasons.some((r) => CLAIM_REASONS.has(r))
const ZW = String.fromCodePoint(0x200b)

describe('INT-201: invisible characters between the words of the latest message', () => {
  it('every claim × every separator is a payment hand-off', () => {
    for (const p of CLAIMS) {
      for (const s of SEPARATORS) {
        const t = p.split(' ').join(s)
        assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', `${p} / U+${s.codePointAt(0)!.toString(16)}`)
      }
    }
  })
  it('the confirm-ask reply check reads the gapped text too', () => {
    assert.equal(mentionsConfirmVerb(`¿Me${ZW}confirmás?`), true)
    assert.equal(hasPaymentWord(`ya${ZW}pagué`), true)
    assert.equal(held('¡Claro que sí!', `¿Me${ZW}confirmás?`), true)
    assert.equal(held('¡Sí, nos llegó! 🙌', `¿Me${ZW}confirmás?`), true)
    assert.equal(held('¡Perfecto, gracias por pagar!', ['Ya', 'le', 'hice', 'el', 'sinpe'].join(ZW)), true)
  })
})

describe('INT-158 M1: English / Portuguese / French payment state', () => {
  it('customer side: a person takes it', () => {
    for (const t of ['Did you receive my payment?', 'Payment done', 'I paid yesterday, did it arrive?', 'Here is my transfer receipt', 'pagamento feito', 'paiement envoyé']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['Do you ship to Escazú?', 'How can I pay?', 'Hola, ¿tienen talla M?']) assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })
  it('reply side: held on every reply', () => {
    for (const r of ['Yes, we received your payment ✅', 'Payment received, thanks!', 'Your order has shipped 🚚', 'Payment confirmed', 'Pagamento recebido', 'Paiement reçu']) {
      assert.equal(held(r, 'hola'), true, r)
    }
  })
})

describe('INT-158 M2: common Spanish done-claims are held', () => {
  it('held', () => {
    for (const r of ['Gracias por tu pago 🙌', '¡Perfecto, gracias por pagar!', 'Pagado ✅', 'Todo pagado 👍', 'Ya lo tenés pagado', 'Pago completado', 'Pago procesado ✅', 'Pago exitoso ✅', 'Confirmo que pagaste', 'Ya tenemos tu plata', 'Pedido enviado ✅', 'Tu pedido: enviado', 'Tu pedido: despachado 📦']) {
      assert.equal(held(r, 'hola'), true, r)
    }
  })
  it('next-step lines are not held', () => {
    for (const r of ['Cuando tu pedido sea enviado te paso la guía.', 'El pedido enviado por Correos llega en 2 a 4 días.', 'Una vez el pago completado, sale hoy.', 'Gracias por tu compra 😊', 'Gracias por escribirnos', '¿Te ayudo con el pedido?']) {
      assert.equal(held(r, 'hola'), false, r)
      assert.equal(held(r, 'hola', true), false, r)
    }
  })
})

describe('INT-202: a bare "yes" to a status question, through markup and emoji', () => {
  it('held', () => {
    for (const r of ['*¡Claro que sí!*', '_¡Claro que sí!_', '~¡Hecho!~', `¡Cla${String.fromCodePoint(0xad)}ro que sí!`, '👍🏽', '🙋‍♀️', ':)', ':D', '<3', '😊']) {
      assert.equal(held(r, '¿Ya está?'), true, r)
    }
  })
  it('a question or a next step is not held', () => {
    for (const r of ['😊 ¿Qué producto te interesa?', '👍 ¿Te paso los datos?']) assert.equal(held(r, '¿Ya está?'), false, r)
    assert.equal(held('👍', 'hola'), false)
  })
})

describe('INT-205: the sent (shortened) text gets the payment context', () => {
  it('live and Probar pass conversationPaymentContext into applyFinalOutputPolicy, which passes it on', () => {
    const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.equal(turn.match(/paymentContext: conversationPaymentContext\(/g)?.length, 2)
    assert.match(readFileSync('src/lib/soft-ai/llm/output-validator.ts', 'utf8'), /customerText: input\.customerText,\s+paymentContext: input\.paymentContext,/)
  })
})
