/**
 * Lane C engine findings D3 / P8 / D6-negated (Forge + Pura Sonrisa exams, 2026-10-22).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/lane-c-d3-night.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { isComplaintText, moneyHandoffLine, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { applyAfterHoursText, COMPLAINT_HANDOFF_LINE, dropImmediatePromises } from '@/lib/soft-ai/business-hours'
import { dealProblem } from '@/lib/soft-ai/llm/output-validator'

const FACTS = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '88880000', holderName: 'Ana Mora' } } })
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const NIGHT = { afterHours: true, label: 'hoy a las 9:00 a. m.', transparent: false } as Parameters<typeof applyAfterHoursText>[1]
const OPTS = { safeReview: SAFE_LINE.review, paymentSoon: SAFE_LINE.paymentSoon }

describe('D3: a complaint / late order / refund gets empathy, never "¡Gracias!"', () => {
  it('code-decided hand-offs (the hand-off itself is unchanged)', () => {
    for (const [t, reason] of [
      ['Hace 10 días pagué y no me ha llegado', 'payment'],
      ['No me funcionaron, quiero que me devuelvan la plata', 'complaint'],
      ['Pagué hace 10 días y nada, qué mal servicio', 'payment'],
    ] as const) {
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS }) as { text?: string; handoff: { reason: string } | null }
      assert.equal(d.handoff?.reason, reason, t)
      assert.equal(d.text, COMPLAINT_HANDOFF_LINE, t)
      assert.doesNotMatch(String(d.text), /Gracias/, t)
    }
    const receipt = decideInbound({ inboundText: 'Ya pagué, adjunto el comprobante', brandFacts: FACTS, shortcuts: SHORTCUTS }) as { text?: string }
    assert.equal(receipt.text, SAFE_LINE.payment)
  })
  it('model turns: receipt cue, payment claim and a refund hand-off pick the line from the customer text', () => {
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, receiptCue: true, customerText: 'Hace 10 días pagué y no me ha llegado' }).text, SAFE_LINE.complaint)
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, receiptCue: true, customerText: 'ya pagué' }).text, SAFE_LINE.payment)
    assert.equal(moneyHandoffLine('complaint', ''), SAFE_LINE.complaint)
    assert.equal(moneyHandoffLine('payment', 'listo, ya hice el sinpe'), SAFE_LINE.payment)
    for (const t of ['no me ha llegado el pedido', 'nunca llegó', 'qué mal servicio', 'quiero un reembolso', 'me llegó roto']) assert.equal(isComplaintText(t), true, t)
    for (const t of ['¿Cuándo llega?', 'ya pagué', 'Hi, how much is it?']) assert.equal(isComplaintText(t), false, t)
  })
  it('at night the complaint line keeps its empathy', () => {
    const night = applyAfterHoursText({ text: SAFE_LINE.complaint, handoff: { kind: 'handoff', reason: 'payment' } }, NIGHT, OPTS)
    assert.match(night, /^Lamento mucho lo que pasó 🙏 A esta hora el equipo no está disponible; te escriben hoy a las 9:00 a\. m\./)
    assert.doesNotMatch(night, /Gracias|revisan tu pago/)
  })
})

describe('P8: at night, "me atiende alguien" never promises "en un momento"', () => {
  it('the immediate promise is dropped; the owner\'s other words stay', () => {
    const seed = applyAfterHoursText({ text: 'Claro 😊 en un momento te escribe alguien de la tienda.', handoff: { kind: 'handoff', reason: 'human_request' } }, NIGHT, OPTS)
    assert.doesNotMatch(seed, /en un momento/)
    assert.match(seed, /hoy a las 9:00 a\. m\./)
    const owner = applyAfterHoursText({ text: 'Claro, con gusto. En un momento te escribe Ana.', handoff: { kind: 'handoff', reason: 'human_request' } }, NIGHT, OPTS)
    assert.equal(owner, 'Claro, con gusto.\nEl equipo te escribe hoy a las 9:00 a. m.')
    assert.equal(dropImmediatePromises('Enseguida te escriben. Gracias por la paciencia.'), 'Gracias por la paciencia.')
  })
})

describe('D6: "No manejamos descuentos" is not an offer', () => {
  it('a closed negation before the word passes; a real offer is still held', () => {
    for (const t of ['No manejamos descuentos, pero el combo sale ₡32 800', 'No tenemos promociones ni descuentos 😊', 'Sin descuento, el precio es ₡14 900', 'No hay ningún descuento ahorita']) assert.equal(dealProblem(t, []), false, t)
    for (const t of ['Te hago un descuento', 'No olvides que hay descuento', 'No te preocupes, hay descuento hoy', '¿Querés un descuento?']) assert.equal(dealProblem(t, []), true, t)
  })
})
