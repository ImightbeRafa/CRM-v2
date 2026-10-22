/**
 * SecureDog wave 2026-10-22 final verdict (lane D): the two remaining Highs, closed structurally.
 * INT-206 (statement form): after the store sent its payment details, a short done-bubble goes to a person.
 * INT-209 (residual): a word spelled entirely in look-alikes inside a Latin message, or accent stuffing, goes to a person.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/securedog-wave-d-final.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyPaymentText, hasMixedScriptWord, isShortDoneBubble } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'

const FACTS = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '88880000', holderName: 'Ana Mora' } } })
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const decide = (inboundText: string, paymentDetailsSent: boolean) =>
  decideInbound({ inboundText, brandFacts: FACTS, shortcuts: SHORTCUTS, paymentDetailsSent })

describe('INT-206 statement form: a short done-bubble after the payment details', () => {
  it('goes to a person', () => {
    for (const t of ['Listo', 'Listo ✅', 'Hecho', 'Ya quedó', 'Ahí va', 'Ok listo', 'ya pagúe', '✅', 'Ya']) {
      assert.equal(isShortDoneBubble(t), true, t)
      assert.equal(decide(t, true).paymentClass, 'payment_proof_or_risk', t)
    }
  })
  it('before any payment details, and for questions or longer messages, it is ordinary', () => {
    for (const t of ['Listo', 'Ok listo', 'Hecho']) assert.notEqual(decide(t, false).paymentClass, 'payment_proof_or_risk', t)
    for (const t of ['¿Listo?', 'Gracias 🙏', 'Hola', 'Listo, ¿y cuánto sale el envío a Heredia más o menos?']) assert.equal(isShortDoneBubble(t), false, t)
  })
  it('live and Probar both pass paymentDetailsSent', () => {
    const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.equal(turn.match(/paymentDetailsSent: history\.some\(\(m\) => m\.direction === 'outbound' && paymentDetailsIn\(m\.content \|\| ''\)\)/g)?.length, 2)
  })
})

describe('INT-209 residual: whole look-alike words and accent stuffing', () => {
  it('go to a person', () => {
    for (const t of ['Ya раցսе́', 'уа ӏе һісе еӏ ѕіոре', 'Ya págué', 'Ya pạgué', 'Hola, ya ѕіոре']) {
      assert.equal(hasMixedScriptWord(t), true, t)
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
  it('normal Spanish, Portuguese place names and a fully foreign-script message are not flagged', () => {
    for (const t of ['José María quiere el combo', 'Sí, qué rico', 'Pingüino, cigüeña, ñandú', 'São José', 'Привет', 'Hola 😊👍🏽', 'Vitamina B12 1000 µg']) {
      assert.equal(hasMixedScriptWord(t), false, t)
    }
  })
})
