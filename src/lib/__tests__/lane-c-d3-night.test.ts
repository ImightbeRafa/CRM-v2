/**
 * Lane C engine findings D3 / P8 (Forge + Pura Sonrisa exams, 2026-10-22).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/lane-c-d3-night.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'
import { isComplaintText, moneyHandoffLine, planModelTurnDelivery, SAFE_LINE } from '@/lib/soft-ai/agent-turn-outcome'
import { applyAfterHoursText, COMPLAINT_HANDOFF_LINE, dropImmediatePromises } from '@/lib/soft-ai/business-hours'

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

describe('Verifier / SecureDog review fixes (D3 / P8)', () => {
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
  it('P8 keeps a sentence with an e-mail, a link, a phone or a safety instruction', () => {
    assert.equal(dropImmediatePromises('Claro 😊 Escribinos a ventas@tienda.com o en un momento te atiende Ana.'), 'Claro 😊 Escribinos a ventas@tienda.com o en un momento te atiende Ana.')
    assert.equal(
      dropImmediatePromises('Suspendé el uso inmediatamente; en un momento te escribe alguien del equipo.'),
      'Suspendé el uso inmediatamente; en un momento te escribe alguien del equipo.',
    )
  })
})

describe('Lane C scan: the engine "Pedido confirmado" template never claims a written order', () => {
  it('the seed and the upgraded legacy bodies pass the final policy; the old text is upgraded', async () => {
    const { applyFinalOutputPolicy } = await import('@/lib/soft-ai/llm/output-validator')
    const { ORDER_CONFIRMED_BODY, RESERVED_SHORTCUT_SEEDS, renderShortcutTemplate, upgradeLegacyShortcutBody } = await import('@/lib/soft-ai/shortcuts')
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
