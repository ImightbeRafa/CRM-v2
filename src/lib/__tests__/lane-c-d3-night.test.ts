/**
 * Lane C engine findings D3 / P8 (Forge + Pura Sonrisa exams, 2026-10-22), fail-safe versions (Verifier #130).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/lane-c-d3-night.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { isComplaintText, moneyHandoffLine, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { afterHoursHandoffLine, applyAfterHoursText, COMPLAINT_HANDOFF_LINE, hasImmediatePromise } from '@/lib/soft-ai/business-hours'

const FACTS = parseBrandFacts({ payment: { shareWithCustomers: true, methods: ['sinpe'], sinpe: { number: '88880000', holderName: 'Ana Mora' } } })
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const NIGHT = { afterHours: true, label: 'hoy a las 9:00 a. m.', transparent: false } as Parameters<typeof applyAfterHoursText>[1]
const OPTS = { safeReview: SAFE_LINE.review, paymentSoon: SAFE_LINE.paymentSoon }
const NIGHT_PERSON = afterHoursHandoffLine('person', 'hoy a las 9:00 a. m.')
const lineFor = (inboundText: string, earlierCustomerTexts?: string[]) =>
  (decideInbound({ inboundText, earlierCustomerTexts, brandFacts: FACTS, shortcuts: SHORTCUTS }) as { text?: string }).text

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
    }
    assert.equal(lineFor('Ya pagué, adjunto el comprobante'), SAFE_LINE.payment)
  })
  it('model turns: receipt cue, payment claim and a refund hand-off pick the line from the customer text', () => {
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, receiptCue: true, customerText: 'Hace 10 días pagué y no me ha llegado' }).text, SAFE_LINE.complaint)
    assert.equal(planModelTurnDelivery({ text: 'x', textOk: true, llmHandoff: null, receiptCue: true, customerText: 'ya pagué' }).text, SAFE_LINE.payment)
    assert.equal(moneyHandoffLine('complaint', ''), SAFE_LINE.complaint)
    assert.equal(moneyHandoffLine('payment', 'listo, ya hice el sinpe'), SAFE_LINE.payment)
    for (const t of ['no me ha llegado el pedido', 'nunca llegó', 'qué mal servicio', 'quiero un reembolso', 'me llegó roto']) assert.equal(isComplaintText(t), true, t)
  })
  it('fail safe: a receipt-status question keeps "¡Gracias!" (Verifier #128-4, #130-2)', () => {
    for (const t of [
      'Ya pagué y nada más quería avisar',
      'Ya pagué, perdón si molesto',
      'Ya hice el sinpe, ¿no llegó?',
      'Ya pagué, ¿no ha llegado la notificación?',
      'Ya hice el sinpe del pedido, ¿no llegó?',
      'Ya te mandé el comprobante, ¿todavía no llega?',
      'Ya pagué el pedido por SINPE, ¿no ha llegado?',
      'Ya hice la transferencia de la compra, ¿aún no llega?',
      'Ya pagué el envío, todavía no me llega el número de guía',
      'Ya pagué y nada, eso era todo 😊',
      'Ya hice el sinpe, el link de pago no me funcionó',
    ]) {
      assert.equal(isComplaintText(t), false, t)
      assert.equal(lineFor(t), SAFE_LINE.payment, t)
    }
    assert.equal(isComplaintText('Quiero 2 kits para el pedido\nYa hice el sinpe, ¿no llegó?'), false)
  })
  it('the burst is read joined: a complaint split over two bubbles counts (Verifier #130-4)', () => {
    assert.equal(lineFor('y no me ha llegado', ['Pagué hace 10 días']), SAFE_LINE.complaint)
    assert.equal(lineFor('Ya pagué hace 10 días', ['Todavía no me llega el pedido']), SAFE_LINE.complaint)
  })
  it('at night the complaint line keeps its empathy', () => {
    const night = applyAfterHoursText({ text: SAFE_LINE.complaint, handoff: { kind: 'handoff', reason: 'payment' } }, NIGHT, OPTS)
    assert.match(night, /^Lamento mucho lo que pasó 🙏 A esta hora el equipo no está disponible; te escriben hoy a las 9:00 a\. m\./)
    assert.doesNotMatch(night, /Gracias|revisan tu pago/)
  })
})

describe('P8 fail safe: at night a "right now" promise is replaced whole by the night line', () => {
  const optOut = (text: string) => applyAfterHoursText({ text, handoff: { kind: 'handoff', reason: 'human_request' } }, NIGHT, OPTS)
  it('every promise text gets the night person line (nothing cut, nothing garbled)', () => {
    for (const t of [
      'Claro 😊 en un momento te escribe alguien de la tienda.',
      'Claro, con gusto. En un momento te escribe Ana.',
      'Claro 😊 en un momento te atiende la Dra. Mora.',
      'Claro 😊 en un momento te escribe alguien de la tienda (atendemos de 8:00 a. m. a 6:00 p. m.).',
      'Te paso con alguien del equipo enseguida, el horario es de 8:00 a. m. a 6:00 p. m.',
      'Con gusto, en un momento te atiende el Dr. Solís. Gracias por tu paciencia.',
      'Gracias por escribirnos. Te paso con alguien enseguida, aprox. 5 min.',
      'Dame chance, ya mismo te contactan',
      'Enseguida te confirmo.',
    ]) {
      assert.equal(hasImmediatePromise(t), true, t)
      assert.equal(optOut(t), NIGHT_PERSON, t)
    }
  })
  it('a text with no "right now" promise keeps every word and gets the team line', () => {
    assert.equal(optOut('Escribinos a ana@tienda.com o al 2222.3333.'), 'Escribinos a ana@tienda.com o al 2222.3333.\nEl equipo te escribe hoy a las 9:00 a. m.')
    assert.equal(hasImmediatePromise('Ahorita tenemos el kit en ₡14 900.'), false)
  })
  it('an unknown_answer reply keeps its facts at night', () => {
    const unknown = applyAfterHoursText(
      { text: 'Ahorita tenemos el kit en ₡14 900. El detalle exacto de la mezcla no lo tengo acá; lo confirmo y te lo paso.', handoff: { kind: 'handoff', reason: 'unknown_answer' } },
      NIGHT,
      OPTS,
    )
    assert.match(unknown, /^Ahorita tenemos el kit en ₡14 900\. El detalle exacto/)
  })
})

describe('Lane C scan: the engine "Pedido confirmado" template never claims a written order', () => {
  it('the seed and the upgraded legacy bodies pass the final policy; the old text is upgraded', async () => {
    const { applyFinalOutputPolicy } = await import('@/lib/soft-ai/llm/output-validator')
    const { ORDER_CONFIRMED_BODY, renderShortcutTemplate, upgradeLegacyShortcutBody } = await import('@/lib/soft-ai/shortcuts')
    const seed = RESERVED_SHORTCUT_SEEDS.find((s) => s.key === 'sys_order_confirmed')
    assert.equal(seed?.body, ORDER_CONFIRMED_BODY)
    assert.doesNotMatch(ORDER_CONFIRMED_BODY, /registrad|confirmad|cread/)
    for (const legacy of ['Listo, tu pedido {{order.orderId}} quedó registrado 😊 Te aviso cualquier cosa.', 'Tu pedido {{order.orderId}} quedó registrado por el equipo. Te escribimos si falta algún dato.']) {
      assert.equal(upgradeLegacyShortcutBody(legacy), ORDER_CONFIRMED_BODY)
    }
    const text = renderShortcutTemplate(ORDER_CONFIRMED_BODY, { facts: FACTS, clientFirstName: null })
    const policy = applyFinalOutputPolicy({ text, intent: 'order_status', citedToolNames: [], brandFacts: FACTS, shortcuts: [] } as never) as { needsHuman: boolean; reasons: string[] }
    assert.equal(policy.needsHuman, false)
    assert.deepEqual(policy.reasons, [])
  })
})

describe('SecureDog #130 Lows', () => {
  it('L1: an opt-out text with a safety notice keeps every word at night', async () => {
    const { hasSafetyNotice } = await import('@/lib/soft-ai/business-hours')
    const t = 'En un momento te escribe alguien; nunca te pediremos tu PIN ni contraseñas.'
    assert.equal(hasSafetyNotice(t), true)
    assert.equal(applyAfterHoursText({ text: t, handoff: { kind: 'handoff', reason: 'human_request' } }, NIGHT, OPTS), `${t}\nEl equipo te escribe hoy a las 9:00 a. m.`)
  })
  it('L2: an owner-edited payment hand-off text is kept on a complaint', () => {
    const own = SHORTCUTS.map((s) => (s.key === 'sys_handoff_payment' ? { ...s, body: '¡Gracias! Lo reviso. Nunca te pediremos tu PIN 🙏' } : s))
    const d = decideInbound({ inboundText: 'Hace 10 días pagué y no me ha llegado', brandFacts: FACTS, shortcuts: own }) as { text?: string }
    assert.equal(d.text, '¡Gracias! Lo reviso. Nunca te pediremos tu PIN 🙏')
  })
  it('L3: the keyword matcher never sends a reserved engine template', async () => {
    const { matchVerbatimShortcut } = await import('@/lib/soft-ai/shortcuts')
    const rows = SHORTCUTS.map((s) => (s.key === 'sys_order_confirmed' ? { ...s, keywords: ['pedido'] } : s))
    assert.equal(matchVerbatimShortcut('¿Cómo hago un pedido?', rows as never), null)
  })
})

describe('Verifier #130 r2', () => {
  const optOut = (text: string) => applyAfterHoursText({ text, handoff: { kind: 'handoff', reason: 'human_request' } }, NIGHT, OPTS)
  it('#1 urgency / contact / price text is never swapped away at night', () => {
    for (const t of [
      'Claro 😊 en un momento te escribe alguien. Si es una urgencia, llamá al 8888-8888.',
      'En un momento te escribe alguien. Para emergencias llamá al 2222 3333.',
      'Enseguida te escribe alguien; si es urgente escribí a ventas@tienda.com',
      'Claro, el kit sale ₡14.900 y enseguida te escribe Ana para coordinar.',
    ]) assert.equal(optOut(t), `${t}\nEl equipo te escribe hoy a las 9:00 a. m.`, t)
  })
  it('#2 a payment verb is a receipt question unless days went by; #4 "no estoy molesta" is calm', () => {
    for (const t of ['Ya pagué el pedido, ¿no ha llegado?', 'Ya pagué la compra, ¿todavía no llega?', 'Ya transferí lo del pedido, ¿no ha llegado?', 'Ya deposité lo de la orden, ¿aún no llega?', 'Ya mandé el dinero del pedido, ¿no ha llegado?', 'No estoy molesta, ya hice el sinpe 😊', 'Ya pagué, no estoy enojada solo pregunto']) {
      assert.equal(isComplaintText(t), false, t)
    }
    assert.equal(isComplaintText('Hace 10 días pagué y no me ha llegado'), true)
    assert.equal(isComplaintText('Hace una semana pagué el pedido y no ha llegado'), true)
  })
})
