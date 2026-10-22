/**
 * SecureDog wave 2026-10-22 round 4 (lane D) — structural rules instead of phrase lists:
 * INT-209 (a word mixing scripts / odd Latin look-alikes → a person), M1 customer side (a bubble written in English / PT /
 * FR with a state word → a person; those words also open the "¿ya pagó?" model check), M1 reply side (Title Case runs are
 * names only when the store's own text has them), INT-206 (in a payment chat, a yes-first / emoji-only reply to any
 * customer question is rewritten).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/securedog-wave-d-r4.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, hasMixedScriptWord } from '@/lib/soft-ai/payment-classifier'
import { paymentCheckGate } from '@/lib/soft-ai/payment-claim-check-core'
import { validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { REPAIRABLE_REASONS } from '@/lib/soft-ai/llm/runtime'

const reasons = (text: string, customerText: string, paymentContext = false, ownText?: string) =>
  validateAgentOutput({ text, citedToolNames: [], modelText: true, customerText, paymentContext, ownText }).reasons
const sent = (text: string, customerText: string, paymentContext = false, ownText?: string) => reasons(text, customerText, paymentContext, ownText).length === 0

describe('INT-209: mixed-script words', () => {
  it('go to a person', () => {
    for (const t of ['Ya le hıce el sınpe, ¿me confırmás?', '¿Lօ recibierօn?', '¿Les ӏӏegó?', '¿Lᴇs llᴇgó?', 'Pаid', 'Yа pаgué']) {
      assert.equal(hasMixedScriptWord(t), true, t)
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('normal Spanish, accents, ñ, emoji and numbers are not mixed', () => {
    for (const t of ['Jalapeño, cigüeña, pingüino 😊', '¿Tienen el combo Dúo a ₡22.800?', 'Crème brûlée', 'Hola! Quiero 2 👍🏽']) assert.equal(hasMixedScriptWord(t), false, t)
  })
})

describe('M1 customer side: a bubble written in English / PT / FR with a state word', () => {
  it('goes to a person', () => {
    for (const t of ['I sent it', 'Just sent', 'Already sent', "It's done", 'All done!', 'I made the transfer', 'Transfer is done', "Money's sent", 'Depositei', 'Fiz a transferência', 'Já foi', "Je vous ai envoyé l'argent"]) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('Spanish with an English product name is not', () => {
    for (const t of ['¿Tienen el Done Patch?', 'Quiero 2 Done Patch', '¿Aceptan cash?', '¿Tienen papel transfer?']) assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })
  it('EN / PT / FR money words open the "¿ya pagó?" model check in a chat with no payment talk', () => {
    for (const t of ['Just sent', 'Did it go through?', 'Já foi', 'Fiz o pix']) assert.equal(paymentCheckGate(t, []), true, t)
    assert.equal(paymentCheckGate('Hola, ¿tienen talla M?', []), false)
  })
})

describe('M1 reply side: Title Case and more single words in a payment chat', () => {
  it('held with payment in play', () => {
    for (const r of ['Your Order Is Confirmed', 'Payment Went Through', 'Thank You For Your Payment', 'Order Confirmed', 'Approved', 'Verified', 'Completed', 'Success', 'Arrived', 'Perfect', 'Chegou', 'Recebi', 'Aprovado']) {
      assert.equal(sent(r, '¿Cómo va?', true), false, r)
    }
  })
  it("the store's own Title Case names are fine", () => {
    const own = JSON.stringify({ name: 'Thank You Farmer', catalog: ['Yes To Tomatoes', 'Done Patch'] })
    for (const r of ['Thank You Farmer Sun Project a ₡14.900 ✨', 'Yes To Tomatoes en stock 😊', 'El Done Patch está a ₡9.900 😊']) {
      assert.ok(!reasons(r, 'hola', true, own).some((x) => x === 'payment_status_claim' || x === 'non_spanish_reply'), r)
    }
  })
})

describe('INT-206: in a payment chat, a yes first to any customer question is rewritten', () => {
  it('repairable, never sent as is', () => {
    assert.ok(REPAIRABLE_REASONS.has('affirm_first'))
    for (const q of ['¿Ya se acreditó?', '¿Todo en orden?', '¿Todo correcto?', '¿Ya aparece?', '¿Lo pudieron ver?', '¿Ya lo revisaron?', '¿Novedades?', '¿Ya está todo?', '¿Y ya?', '¿Está bien así?', '¿Les llegó lo que les mandé?']) {
      for (const r of ['¡Claro que sí!', '¡Sí!', '👍', '¡Sí! ¿Algo más?', 'Hola, sí, ¿te ayudo con algo más?']) {
        assert.equal(sent(r, q, true), false, `${q} → ${r}`)
      }
    }
  })
  it('a direct answer, or no payment in play, goes out', () => {
    assert.equal(sent('Tenemos el de dormir 😊 ¿Te lo aparto?', '¿Lo tienen?', true), true)
    assert.equal(sent('¡Claro! Tenemos el de dormir 😊', '¿Tienen el de dormir?'), true)
  })
})
