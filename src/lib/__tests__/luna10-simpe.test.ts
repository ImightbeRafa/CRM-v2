import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { paymentChoiceGrammar } from '../soft-ai/payment-classifier'

describe('live 467818: "Simpe" is SINPE (a method choice, not a payment claim)', () => {
  it('misspellings choose SINPE', () => {
    for (const t of ['Simpe', 'simpe movil porfa', 'Sinpi', 'por simpe']) assert.deepEqual(paymentChoiceGrammar(t), { method: 'sinpe', ask: false }, t)
  })
  it('a claim stays a claim whatever the spelling', () => {
    for (const t of ['ya hice el simpe', 'simpe listo', 'Simpe ✅']) assert.equal(paymentChoiceGrammar(t), null, t)
  })
})
