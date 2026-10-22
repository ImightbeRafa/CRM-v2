/**
 * SecureDog wave 2026-10-22 round 2 (lane D): INT-206 ("¿Ya está?" after another bubble), INT-207 (visible blanks that are
 * not whitespace), INT-158 M1 deny-by-default (English / PT / FR), INT-208 (done-claims reopened by the narrowing),
 * INT-202 residual (a reply that starts with a yes), M2 third person, two-pronoun claims before a question.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/securedog-wave-d-r2.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText } from '@/lib/soft-ai/payment-classifier'
import { readsAsForeignLanguage, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { REPAIRABLE_REASONS } from '@/lib/soft-ai/llm/runtime'

const HOLD = new Set(['payment_status_claim', 'confirmation_wording', 'write_claim'])
const reasons = (text: string, customerText: string, paymentContext = false) =>
  validateAgentOutput({ text, citedToolNames: [], modelText: true, customerText, paymentContext }).reasons
const held = (text: string, customerText: string, paymentContext = false) => reasons(text, customerText, paymentContext).some((r) => HOLD.has(r))
const BURST = ['Hola, quiero los parches', '¿Ya está?'].join('\n')

describe('INT-206 / INT-202: a yes to "¿Ya está?" after another bubble', () => {
  it('held', () => {
    for (const r of ['¡Claro que sí!', '¡Hecho!', '¡Sí!', 'Sí, claro', 'Correcto', '👍', 'Sí ✓', 'Sí ★', 'Sí ^^', 'Sí :3', 'Sí XD', 'Sí jaja', 'Siii', 'Sip', 'Ajá', '¡Así es!', 'Efectivamente', 'Afirmativo', 'De fijo', 'Pura vida', 'Yes', '¡Sí! ¿Algo más?']) {
      assert.equal(held(r, BURST, true), true, r)
      assert.equal(held(r, BURST), true, r)
    }
  })
  it('handing the check to the team or asking is not held', () => {
    for (const r of ['El equipo lo revisa y te confirma por aquí 😊', 'Un momento, el equipo verifica y te aviso.', '¿Qué producto te interesa?']) {
      assert.equal(held(r, BURST, true), false, r)
    }
  })
})

describe('INT-207: a visible blank that is not whitespace (U+2800, U+FFFC) glues no claim', () => {
  it('hand-off, or the yes is held', () => {
    for (const blank of [0x2800, 0xfffc].map((c) => String.fromCodePoint(c))) {
      for (const c of ['Le pasé la plata, ¿les llegó?', 'Ya les mandé la plata, ¿la recibieron?', 'Listo, ya les cayó, ¿verdad?', 'Ya está hecho, ¿lo recibieron?', '¿Les llegó?', '¿Lo recibieron?', '¿Le cayó?', 'ya pagué', 'ya le hice el sinpe']) {
        const t = c.split(' ').join(blank)
        assert.ok(classifyPaymentText(t) === 'payment_proof_or_risk' || held('¡Claro que sí!', t, true), c)
      }
    }
  })
})

describe('INT-158 M1: deny by default for English / PT / FR', () => {
  it('customer side: a person takes it', () => {
    for (const c of ['I have paid', "I've paid", 'Paid!', "It's paid", 'All paid', 'Money sent', 'Please confirm my payment', 'Have you received it?', 'Did the money arrive?', 'My wife paid', 'Paguei', 'Já fiz o pagamento', 'Fiz o pix', "J'ai fait le virement", 'Virement effectué', 'Paiement bien reçu ?', 'Ya está paid', 'Listo, sent', 'How can I pay?']) {
      assert.equal(classifyPaymentText(c), 'payment_proof_or_risk', c)
    }
    for (const c of ['Do you ship to Escazú?', 'Hola, quiero 2 paquetes']) assert.notEqual(classifyPaymentText(c), 'payment_proof_or_risk', c)
  })
  it('reply side: a reply in English / PT / FR is never sent as is', () => {
    for (const r of ['Got it, thanks!', 'Yes, we received it', 'Your order is confirmed', 'Thanks for paying!', 'Your payment went through', "It's paid", 'Recebemos seu pagamento', 'Nous avons bien reçu votre paiement']) {
      assert.ok(reasons(r, 'Did you get it?').length > 0, r)
      assert.equal(held(r, 'Did you get it?'), true, r)
    }
    // no payment in play: rewritten in Spanish (repairable), not a payment hold
    assert.deepEqual(reasons('Thanks for your message, we have it in stock', 'hola'), ['non_spanish_reply'])
    assert.ok(REPAIRABLE_REASONS.has('non_spanish_reply'))
    for (const r of ['Mirá: Sleeping Patches Combo Dúo', 'Te paso el link: https://patchhouse.cr/product/the-best-patch', '¡Hola! Soy Sofi 😊 ¿En qué te ayudo?', 'El combo de 2 está a ₡22 800 con envío incluido.']) {
      assert.equal(readsAsForeignLanguage(r), false, r)
    }
  })
})

describe('INT-208: done-claims in a sentence are held again; offers and next steps are not', () => {
  it('held', () => {
    for (const r of ['¡Gracias! Todo pagado', 'Listo, todo pagado', 'Ya lo tenés pagado, gracias', 'Pagado, gracias', 'Pagado. Gracias', 'Todo pagado y listo', 'Está todo pagado', 'todo pagado, ¡gracias por tu compra!', 'Gracias, pago completado', 'Listo, pago exitoso', 'Pago completado con éxito', 'Gracias Pago exitoso', 'Ya está todo pagado', '¡Pagado!', 'Tu pago fue exitoso, gracias', 'El pago quedó completado', 'El equipo confirmo tu pago', 'Ya confirmaron tu pago', 'Ya verificaron tu pago', 'Ya aprobaron tu pago']) {
      assert.equal(held(r, 'hola'), true, r)
    }
  })
  it('not held', () => {
    for (const r of ['Se deja todo pagado por adelantado y te lo enviamos.', '¿Querés dejarlo todo pagado?', 'Si preferís, lo dejás todo pagado y lo retirás cuando quieras.', '¿Ya lo tenés pagado o lo pagás al recibir?', 'Pagado el pedido, sale el mismo día.', 'Pagada la reserva, te la apartamos.', 'Con el pago completado, sale hoy mismo.', 'Cuando tengamos el pago completado te paso la guía.', 'Una vez que tengamos el pago completado, sale.', 'Tu pago procesado por Tilopay es 100% seguro.', 'Con pago exitoso te llega un correo de Tilopay.', 'Gracias por tu compra 😊']) {
      assert.deepEqual(reasons(r, 'hola'), [], r)
    }
  })
})

describe('Two-pronoun claims and a "Pagado." sentence before a question (r2 #7)', () => {
  it('hand-off', () => {
    for (const c of ['Ya te la mandé, ¿la vieron?', 'Ya se lo pasé, ¿me avisa?', 'Pagado. ¿Cuándo llega?', 'Ok, pagado. ¿Cuándo sale?']) {
      assert.equal(classifyPaymentText(c), 'payment_proof_or_risk', c)
    }
    for (const c of ['Ya pasé por la tienda', '¿Cuánto cuesta el envío a Heredia?', 'Pagado el envío?']) assert.notEqual(classifyPaymentText(c), 'payment_proof_or_risk', c)
  })
})
