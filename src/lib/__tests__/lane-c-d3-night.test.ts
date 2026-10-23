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
    for (const t of ['No tenemos promociones ni descuentos 😊', 'No hay ningún descuento ahorita']) assert.equal(dealProblem(t, []), false, t)
    for (const t of ['Te hago un descuento', 'No olvides que hay descuento', 'No te preocupes, hay descuento hoy', '¿Querés un descuento?']) assert.equal(dealProblem(t, []), true, t)
  })
})

describe('Verifier #128 fixes', () => {
  it('#1 an exception, comparison, nudge or question keeps a negated discount an offer', () => {
    for (const t of [
      'Normalmente no damos descuentos, pero por ser tu primera compra sí. ¿Lo pedimos?',
      'No hay descuento para todos, pero para vos sí 😊 ¿Te lo aparto?',
      'No damos descuentos normalmente, pero a vos te lo hago',
      'No hay descuento como el de hoy 🔥',
      'No existe descuento igual en todo el país',
      'No hay rebaja mayor que esta',
      'Tampoco hay un precio especial mejor que este',
      '¿Por qué no aplicamos un descuento a tu pedido?',
      'Nunca hay un descuento así, ¡aprovechá!',
    ]) assert.equal(dealProblem(t, []), true, t)
    for (const t of ['No manejamos descuentos.', 'No tenemos promociones ni descuentos 😊']) {
      assert.equal(dealProblem(t, []), false, t)
    }
  })
  it('#2 night texts keep numbers, prices, links and line breaks; nothing dropped = unchanged', () => {
    const optOut = (text: string) => applyAfterHoursText({ text, handoff: { kind: 'handoff', reason: 'human_request' } }, NIGHT, OPTS)
    assert.equal(dropImmediatePromises('Cada frasco trae 2.5 ml. El kit sale ₡14.900. Mirá https://tienda.com/tallas'), 'Cada frasco trae 2.5 ml. El kit sale ₡14.900. Mirá https://tienda.com/tallas')
    assert.equal(optOut('Escribinos a ana@tienda.com o al 2222.3333.'), 'Escribinos a ana@tienda.com o al 2222.3333.\nEl equipo te escribe hoy a las 9:00 a. m.')
    assert.equal(
      dropImmediatePromises('Opciones:\n• A.\n• B.\nEnseguida te escribe Ana.'),
      'Opciones:\n• A.\n• B.',
    )
  })
  it('#3 an unknown_answer reply keeps its facts at night ("ahorita" is not a promise without a reply verb)', () => {
    const unknown = applyAfterHoursText(
      { text: 'Ahorita tenemos el kit en ₡14 900. El detalle exacto de la mezcla no lo tengo acá; lo confirmo y te lo paso.', handoff: { kind: 'handoff', reason: 'unknown_answer' } },
      NIGHT,
      OPTS,
    )
    assert.match(unknown, /^Ahorita tenemos el kit en ₡14 900\./)
    assert.equal(dropImmediatePromises('Ahorita tenemos el kit en ₡14 900.'), 'Ahorita tenemos el kit en ₡14 900.')
  })
  it('#4 a plain receipt keeps "¡Gracias!"; #5 a complaint in an earlier bubble counts', () => {
    for (const t of ['Ya pagué y nada más quería avisar', 'Ya pagué, perdón si molesto', 'Ya hice el sinpe, ¿no llegó?', 'Ya pagué, ¿no ha llegado la notificación?']) {
      assert.equal(isComplaintText(t), false, t)
      const d = decideInbound({ inboundText: t, brandFacts: FACTS, shortcuts: SHORTCUTS }) as { text?: string }
      assert.equal(d.text, SAFE_LINE.payment, t)
    }
    const burst = decideInbound({ inboundText: 'Ya pagué hace 10 días', earlierCustomerTexts: ['Todavía no me llega el pedido'], brandFacts: FACTS, shortcuts: SHORTCUTS }) as { text?: string }
    assert.equal(burst.text, SAFE_LINE.complaint)
  })
})

describe('SecureDog #128 r1: the negated discount is a closed refusal, and nothing else in the reply reverses it', () => {
  const ch = (...codes: number[]) => String.fromCharCode(...codes)
  it('every reversal SecureDog found is held', () => {
    for (const t of [
      'No hay descuento para todos. Pero para vos sí 😊 ¿Te lo aparto?',
      'No damos descuentos. Pero a vos te lo hago',
      'No damos descuentos. Pero por ser tu primera compra, sí. ¿Lo pedimos?',
      'Nunca hay un descuento. ¡Aprovechá, hoy sí hay!',
      'No manejamos descuentos; para vos sí 😉',
      'No hay descuento... ¡para vos sí! 😉',
      'No damos descuentos.\nA vos sí 🤫',
      'No rebajamos. Para vos sí 😉',
      'No tenemos promociones ni descuentos. Pero para vos sí 😉',
      'Para vos sí hay. No hay descuento para el resto 😉',
      '• No hay descuento\n• Para vos: 20% 😉',
      'No existe descuento parecido a este 🔥',
      'No hay descuento que se le compare',
      'No hay descuento que no te demos 😉',
      'No hay descuento que supere este',
      'No hay precio especial que le gane a este',
      'Nunca hay rebajas de este tamaño',
      'Ni el descuento de Black Friday se compara con esta oferta',
      'Sin duda, no hay descuento tan bueno en todo el país',
      `No hay descuento para v${ch(0xad)}os s${ch(0xad)}í 😉`,
      'Por qué no aplicamos el descuento de una vez 😉',
      'Y por qué no un descuento 😉',
      'No manejamos descuentos. Pero te hago un 10% 😉',
      'Para vos hoy 12.5% y no hay descuento extra',
      `Te hago un des${ch(0xad)}cuento del 20% 😉`,
      'Te hago un 10% 😉',
    ]) assert.equal(dealProblem(t, []), true, JSON.stringify(t))
  })
  it('the plain refusals Lane C needs still pass', () => {
    for (const t of ['No manejamos descuentos.', 'No tenemos promociones ni descuentos 😊', 'No hay ningún descuento ahorita', 'Por ahora no tenemos descuentos 🙏', 'Lo siento, no manejamos promociones ni rebajas.']) {
      assert.equal(dealProblem(t, []), false, t)
    }
  })
  it('P8 keeps a sentence with an e-mail, a link, a phone or a safety instruction', () => {
    assert.equal(dropImmediatePromises('Claro 😊 Escribinos a ventas@tienda.com o en un momento te atiende Ana.'), 'Claro 😊 Escribinos a ventas@tienda.com o en un momento te atiende Ana.')
    assert.equal(
      dropImmediatePromises('Suspendé el uso inmediatamente; en un momento te escribe alguien del equipo.'),
      'Suspendé el uso inmediatamente; en un momento te escribe alguien del equipo.',
    )
  })
})

describe('SecureDog #128 r2: only a whole-reply closed refusal is exempt; both text forms are judged', () => {
  const ch = (...codes: number[]) => String.fromCharCode(...codes)
  it('H1 / H2 / M1: every offer SecureDog found is held', () => {
    for (const t of [
      'No hay descuentos, pero el combo dos por uno sale ₡14 900.',
      'No manejamos descuentos, pero los dos kits a mitad de precio salen ₡14 900.',
      'No hay descuentos, pero el precio especial para vos queda en ₡9 900.',
      'No tenemos promociones, pero el kit con oferta especial para vos queda en ₡9 900 😉',
      'No hay descuentos, pero el segundo de regalo sale ₡0.',
      'No manejamos descuentos, pero el combo sale ₡32 800',
      'Por ahora no tenemos descuentos 😊\n\nSin embargo, por ser tu primer pedido, podemos hacer una excepción 🙌',
      '¡Entiendo! Por ahora no tenemos descuentos.\n\nNo obstante, para tu primer pedido te puedo aplicar uno pequeño 😊',
      'No manejamos descuentos 🙏\n\nDe todas formas, contame qué kit querés y te consigo uno.',
      'No tenemos descuentos ahorita. Te puedo aplicar uno.',
      'No hay descuentos por ahora. El lunes los activamos 😊',
      '1. No hay descuentos.\n2. Te puedo aplicar uno.',
      'No hay descuentos. But for you, I can make one.',
      'No hay descuentos. P*ero* para v*os* s*í* 😉',
      '¡Hay descuento™ para vos!',
      '¡Hoy 2x1™ en todo!',
      'Precio especial™ para vos',
      `Tenemos descuento${ch(0xad)}para vos 😉`,
      `No manejamos descuentos.\nPero${ch(0xad)}para${ch(0xad)}vos${ch(0xad)}sí 😉`,
    ]) assert.equal(dealProblem(t, []), true, JSON.stringify(t))
  })
  it('L1: a one-line refusal with any emoji form passes', () => {
    for (const t of ['No manejamos descuentos ☺️', `No manejamos descuentos 🙏${ch(0xd83c, 0xdffd)}`, 'Por ahora no tenemos promociones ni descuentos 😊', 'No hay ningún descuento ahorita.']) {
      assert.equal(dealProblem(t, []), false, t)
    }
  })
})
