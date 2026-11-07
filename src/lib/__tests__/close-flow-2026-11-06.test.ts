/**
 * Rafael 2026-11-06 (approved, Forge first): "cuando la IA pide los datos para el envío también tiene que saber cómo
 * pagará y dar los datos del SINPE". Live: José Andrés sent his order data, then a link → the earlier-bubble strict
 * check read "José … La entrega" as a payment claim → "Dame un momento, ya lo reviso" + "Pago por verificar", and the
 * data list had gone out without the payment question (no buy cue → stage descubrir). Real texts (14-day review).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { classifyPaymentText, hasHardPaymentClaim } from '@/lib/soft-ai/payment-classifier'
import { deriveSalesState, formatSalesTurnBlock, type SalesContext } from '@/lib/soft-ai/sales-state'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

const JOSE =
  'José Andrés Quesada Rojas \n71234567\njose.quesada@example.com\nAlajuela \nAlajuela \nAlajuela \n\nLa entrega se haría en el parqueo del súper en Alajuela centro \n\nDirección: 75 oeste del parque central. Avenida 3, Calles 2 y 4.\n\nSe le entregaría a mi papá, él se llama José Quesada.'
const FALSE_ALARMS = [
  JOSE,
  'Francisco Mora Gómez \n88123456',
  'Envió',
  'Hola. Gracias. Solo andaba preguntando porque vi el anuncio y me gustó. Para la 15na sí puedo encargarlo',
  'Ya te paso la dirección',
]
const REAL_CLAIMS = [
  'Hola, te envío el comprobante SINPE del pedido ORD-0000000000000-0000 por ₡14.900.',
  'Ya pagué',
  'ya hice el sinpe',
  'Listo, ya le transferí',
  'Le acabo de mandar el comprobante',
  'Ya les deposité los 26900',
  'Pagado ✅',
  'Ya está pago',
  'Le mandé la plata',
  'Ya le pasé el sinpe',
  'Me cobraron dos veces',
  'Ya hice el pago, revisen porfa',
  'Pagué ayer',
  'Transferí Hoy',
]

const base = { brandFacts: {} as never, shortcuts: [] }

describe('earlier bubbles: strict check AND the full classifier (no false payment hand-off on order data)', () => {
  it('the order data / "Envió" / "me gustó" / "Ya te paso la dirección" before a link is not a payment', () => {
    for (const earlier of FALSE_ALARMS) {
      const d = decideInbound({ ...base, inboundText: '[template]', messageType: 'template', earlierCustomerTexts: [earlier] })
      const pc = d.decisionTrace.steps.find((s: { step: string }) => s.step === 'payment_class') as { outcome: string; reason?: string }
      assert.ok(!String(pc.reason || '').startsWith('earlier_message'), earlier.slice(0, 40))
    }
  })

  it('every real claim in an earlier bubble still hands off (before a link or a question)', () => {
    for (const earlier of REAL_CLAIMS) {
      assert.equal(hasHardPaymentClaim(earlier), true, earlier)
      assert.notEqual(classifyPaymentText(earlier), 'non_payment', earlier)
      const d = decideInbound({ ...base, inboundText: '¿Cuánto dura el envío?', earlierCustomerTexts: [earlier] })
      const pc = d.decisionTrace.steps.find((s: { step: string }) => s.step === 'payment_class') as { outcome: string }
      assert.equal(pc.outcome, 'payment_proof_or_risk', earlier)
    }
  })

  it('a full name opening the data is a name, never a past verb; a capitalised claim still is', () => {
    assert.equal(hasHardPaymentClaim('José Andrés Quesada Rojas\nLa entrega se haría en el parqueo'), false)
    for (const t of ['Pagué ayer', 'Transferí Hoy', 'Mandé El comprobante', 'Pagué Ya']) assert.equal(hasHardPaymentClaim(t), true, t)
  })

  it('the inbound decision requires both checks for an earlier bubble', () => {
    const src = read('src/lib/soft-ai/inbound-decision.ts')
    assert.match(src, /hasHardPaymentClaim\(t, \{ noPaymentYet \}\) &&\s*classifyPaymentText\(t, \{ noPaymentYet \}\) !== 'non_payment'/)
  })
})

const CTX: SalesContext = {
  catalog: [{ name: 'Arnés', price: 14900, stockLabel: 'disponible' }],
  bundles: [{ name: '2 arneses (podés mezclar tallas)', price: 26900, shippingIncluded: true }],
  shippingMethods: [{ name: 'Envío a domicilio', price: 0, coverage: 'todo el país', cod: 'GAM' }],
  orderFields: ['Nombre', 'Teléfono'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['62019914'],
  paymentMethods: ['sinpe', 'transferencia', 'tarjeta', 'contra_entrega'],
  promo: null,
}
let n = 0
const msg = (direction: 'inbound' | 'outbound', content: string): SoftAiHistoryMessage => ({
  id: String((n += 1)),
  direction,
  content,
  sentAt: new Date(2026, 10, 6, 16, n).toISOString(),
})
const QUOTE: SoftAiHistoryMessage[] = [
  msg('inbound', '¿Cuánto cuesta el soporte?'),
  msg('outbound', 'El arnés cuesta ₡14 900 con envío incluido; también hay 2 por ₡26 900. ¿Te gustaría uno o dos?'),
  msg('inbound', 'Los dos, 3XL'),
  msg('outbound', '¿Preferís envío a domicilio o retiro con cita?'),
]
const DATA_ASK = '¡Dale! Pasame estos datos:\n- Nombre completo\n- Teléfono\n- Correo (opcional)\n- Provincia\n- Cantón\n- Distrito\n- Dirección exacta con señas'

describe('the close starts when the customer picks delivery / says the data is coming / after our data request', () => {
  it('live: "Me sirve más la mensajería privada" and "Ya te paso la dirección" → cierre + the payment question', () => {
    for (const t of ['Me sirve más la mensajería privada', 'Ya te paso la dirección', 'Envío a domicilio', 'Retiro con cita', 'Ahí van los datos']) {
      const s = deriveSalesState({ history: QUOTE, inboundText: t, ctx: CTX })
      assert.equal(s.stage, 'cierre', t)
      assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago/, t)
    }
  })

  it('order data after our data request (no method asked yet) → cierre and the payment question', () => {
    const s = deriveSalesState({ history: [...QUOTE, msg('inbound', 'Envío'), msg('outbound', DATA_ASK)], inboundText: JOSE, ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago/)
  })

  it('a question, a retraction, "later" or no money is not the close', () => {
    for (const t of ['¿Hacen envío a domicilio?', 'No lo quiero por ahora', 'Mañana te escribo', 'Ya no lo quiero']) {
      const s = deriveSalesState({ history: QUOTE, inboundText: t, ctx: CTX })
      assert.notEqual(s.stage, 'cierre', t)
    }
    const later = deriveSalesState({ history: [...QUOTE, msg('inbound', 'Envío'), msg('outbound', DATA_ASK)], inboundText: 'Espero la quincena y le aviso', ctx: CTX })
    assert.notEqual(later.stage, 'cierre')
  })

  it('payment details already sent → data afterwards waits for the receipt (never the close again)', () => {
    const history = [...QUOTE, msg('inbound', 'Sinpe'), msg('outbound', '💳 Monto: ₡26 900 · SINPE Móvil: 6201 9914 a nombre de Rafael García. Mandame el comprobante 😊'), msg('outbound', DATA_ASK)]
    const s = deriveSalesState({ history, inboundText: JOSE, ctx: CTX })
    assert.equal(s.stage, 'esperando_comprobante')
  })
})

describe('payment details already sent + the customer\'s plain order data → "Quedo atento al comprobante" (no hand-off)', () => {
  it('plain order data (labelled or not) is plain data; claims, choices, questions and odd text never are', async () => {
    const { isPlainOrderData } = await import('@/lib/soft-ai/payment-classifier')
    for (const t of [
      'José Andrés Quesada Rojas\n71234567\njose.quesada@example.com\nAlajuela\nAlajuela\nAlajuela\nDirección: 75 oeste del parque central',
      'Nombre: Ana Mora\nTeléfono: 8888-8888\nProvincia: Heredia',
    ]) assert.equal(isPlainOrderData(t), true, t.slice(0, 30))
    for (const t of [
      'Ana Mora\n8888-8888\nYa pagué',
      'Ana Mora\nfalta el resto',
      'Ana Mora\nle debo la mitad',
      'Ana Mora\nverifiquen',
      'Ana Mora\n8888-8888\nles transferí 26900',
      'Ana Mora\n8888-8888\ncomprobante adjunto',
      'Ana Mora\n8888-8888\nPago por SINPE',
      'Ana Mora\n¿cuándo llega?',
      'Ana Mora',
      'Ana Mora\nya está',
      'Ana Mora\nhoy en la mañana',
      'Ana\u200bMora\n8888-8888',
    ]) assert.equal(isPlainOrderData(t), false, t)
  })

  it('live and Probar plan the code line only for payment_or_sinpe / payment_claim at esperando_comprobante', () => {
    const src = read('src/lib/soft-ai/agent-turn.ts')
    assert.match(src, /export const WAITING_RECEIPT_LINE = '¡Gracias! Quedo atento al comprobante 🙌'/)
    assert.match(src, /const WAIT_LINE_REASONS = new Set\(\['payment_or_sinpe', 'payment_claim'\]\)/)
    assert.match(src, /if \(trace\?\.stage !== 'esperando_comprobante' \|\| receiptCue \|\| llm\.fallbackUsed \|\| llm\.toolProblem\) return null/)
    assert.equal((src.match(/turnDataWhileWaitingReceipt\(llm, runtimeInput\.salesTrace,/g) || []).length, 2)
    assert.match(src, /text: waitLine \?\? policy\.text,/)
    assert.match(src, /text: probarWaitLine \?\? policy\.text,/)
  })
})
