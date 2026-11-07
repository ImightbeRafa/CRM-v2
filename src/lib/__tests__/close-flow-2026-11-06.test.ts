/**
 * Rafael 2026-11-06 (approved, Forge first): "cuando la IA pide los datos para el envío también tiene que saber cómo
 * pagará y dar los datos del SINPE". Live: a customer sent order data opening with a name ("José …"), then a link →
 * the earlier-bubble strict check read "José … La entrega" as a payment claim → "Dame un momento, ya lo reviso" +
 * "Pago por verificar", and the data list had gone out without the payment question (no buy cue → descubrir).
 * Invented data only (shapes from the 14-day review) + the Verifier 2026-11-06 inputs.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { embeddedPaymentChoice, hasHardPaymentClaim, isPlainOrderData } from '@/lib/soft-ai/payment-classifier'
import { deriveSalesState, formatSalesTurnBlock, type SalesContext } from '@/lib/soft-ai/sales-state'
import { turnDataWhileWaitingReceipt, WAITING_RECEIPT_LINE } from '@/lib/soft-ai/agent-turn'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

const JOSE =
  'José Andrés Quesada Rojas \n71234567\njose.quesada@example.com\nAlajuela \nAlajuela \nAlajuela \n\nLa entrega se haría en el parqueo del súper en Alajuela centro \n\nDirección: 75 oeste del parque central. Avenida 3, Calles 2 y 4.\n\nSe le entregaría a mi papá, él se llama José Quesada.'
const base = { brandFacts: {} as never, shortcuts: [] }
const payClass = (earlier: string, latest: string, extra: object = {}) =>
  (decideInbound({ ...base, inboundText: latest, earlierCustomerTexts: [earlier], ...extra }).decisionTrace.steps.find((s: { step: string }) => s.step === 'payment_class') as { outcome: string; reason?: string })

describe('earlier bubbles: the strict check stays; only plain order data is forgiven', () => {
  it('order data before a link is not a payment (live shape)', () => {
    for (const earlier of [JOSE, 'Francisco Mora Gómez \n88123456', 'Ana Mora Rojas\n88887777\nSan José\nDesamparados\nSan Rafael Abajo\nDel súper 200 sur']) {
      const pc = payClass(earlier, '[template]', { messageType: 'template' })
      assert.ok(!String(pc.reason || '').startsWith('earlier_message'), earlier.slice(0, 30))
    }
  })

  it('Verifier 2026-11-06 #1: real claims in an earlier bubble still hand off (strict check alone)', () => {
    for (const [earlier, latest] of [
      ['Le mandé', 'Gracias'],
      ['Te lo pasé en la mañana', '¿Cuándo me llega?'],
      ['Se lo mandé a su número', 'Me avisa'],
      ['Ya se lo pasé a su compañera', '¿Cuándo llega?'],
      ['Le envié al número', 'Gracias'],
      ['Ya se lo di al mensajero', 'Gracias'],
      ['Pagado hoy', '¿Cuándo lo envían?'],
      ['Le hice uno', '¿Aceptan sinpe?'],
      ['Ya pagué', '¿Cuánto dura el envío?'],
      ['Ya les deposité los 26900', '¿Cuánto dura el envío?'],
      ['Me cobraron dos veces', '¿Cuánto dura el envío?'],
      ['Ana Mora\n88887777\nYa pagué', '[template]'],
    ]) {
      assert.equal(payClass(earlier, latest).outcome, 'payment_proof_or_risk', earlier)
    }
  })

  it('a full name opening the data is a name; payment verbs in Title Case still are claims', () => {
    assert.equal(hasHardPaymentClaim('José Andrés Quesada Rojas\nLa entrega se haría en el parqueo'), false)
    for (const t of ['Pagué ayer', 'Transferí Hoy', 'Mandé El comprobante', 'Pagué Ya', 'Envió Mi Esposo', 'Mandó Mi Esposa', 'Pasó Mi Hijo', 'Envió Ana Mora']) {
      assert.equal(hasHardPaymentClaim(t), true, t)
    }
  })
})

describe('order data shapes (strict): unlabeled lines only as an e-mail, a name / place or an address', () => {
  it('plain data with a contact is plain data', () => {
    for (const t of [
      'José Andrés Quesada Rojas\n71234567\njose.quesada@example.com\nAlajuela\nAlajuela\nAlajuela\nDirección: 75 oeste del parque central',
      'Nombre: Ana Mora\nTeléfono: 8888-8888\nProvincia: Heredia',
      'Ana Mora Rojas\n88887777\nSan José\nDesamparados\nSan Rafael Abajo\nDel súper 200 sur',
    ]) assert.equal(isPlainOrderData(t), true, t.slice(0, 30))
  })

  it('Verifier 2026-11-06 #2: claim-like or free lines are never plain data (with or without a phone)', () => {
    for (const t of [
      'Ana Mora\nTerminé', 'Ana Mora\nsí pude', 'Ana Mora\nlo logré', 'Ana Mora\nmi hermana lo cubrió', 'Ana Mora\nHeredia\nGiró mi esposo',
      'Ana Mora\nla primera parte', 'Ana Mora\nsolo el envío', 'Ana Mora\nlo tiene ahí', 'Ana Mora\nmírelo', 'Ana Mora\ncompleto',
      'Ana Mora\nterminado', 'Ana Mora\nde parte de Ana Mora', 'Ana Mora\n88887777\nTerminé', 'Ana Mora\n88887777\nGiró mi esposo',
      'Ana Mora\n88887777\nla primera parte', 'Ana Mora\n8888-8888\nYa pagué', 'Ana Mora\nfalta el resto', 'Ana Mora\nle debo la mitad',
      'Ana Mora\nverifiquen', 'Ana Mora\n8888-8888\nles transferí 26900', 'Ana Mora\n8888-8888\ncomprobante adjunto',
      'Ana Mora\n8888-8888\nPago por SINPE', 'Ana Mora\n¿cuándo llega?', 'Ana Mora', 'Ana Mora\nya está', 'Ana Mora\nhoy en la mañana',
      'Ana​Mora\n8888-8888', 'Ana Mora\nHeredia',
    ]) assert.equal(isPlainOrderData(t), false, t)
  })

  it('Verifier r2: a capitalised done-word / payment phrase or a loose "address" is never a data line; real places are', () => {
    for (const l of ['Completo', 'Terminado', 'Cumplido', 'Logrado', 'Resuelto', 'Concluido', 'Pude', 'Lo Logré', 'La Primera Parte', 'Solo El Envío', 'Giro Mi Esposo', 'lo tiene en la casa', 'este mismo']) {
      assert.equal(isPlainOrderData(`Ana Mora\n8888-8888\n${l}`), false, l)
      assert.equal(embeddedPaymentChoice(`Ana Mora\n8888-8888\n${l}\nSinpe`), null, l)
    }
    for (const l of ['Desamparados', 'Coronado', 'Alvarado', 'María de los Ángeles Soto', 'Cartago', 'La Unión', 'Del súper 200 sur', 'Frente a la escuela', 'Casa 12, Barrio Los Ángeles', '100 m norte de la iglesia']) {
      assert.equal(isPlainOrderData(`Ana Mora\n8888-8888\n${l}`), true, l)
    }
  })

  it('Verifier 2026-11-06 #7: data + "Sinpe" is a choice only with plain data lines', () => {
    assert.equal(embeddedPaymentChoice('Ana Mora\n8888-8888\nHeredia\nPago por SINPE'), 'sinpe')
    assert.equal(embeddedPaymentChoice('Luis Soto\n87776655\nluis@gmail.com\nSinpe'), 'sinpe')
    for (const t of ['Ana Mora\nla primera parte\nSinpe', 'Ana Mora\nGiró mi esposo\nSinpe', 'Ana Mora\nde parte de mi esposo\nSinpe', 'Ana Mora\nsolo el envío\nSinpe']) {
      assert.equal(embeddedPaymentChoice(t), null, t)
    }
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
  closeWithPay: true,
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
const ASKED = [...QUOTE, msg('inbound', 'Envío'), msg('outbound', DATA_ASK)]

describe('close cue (salesRules.closeWithPay, Forge first)', () => {
  it('live: a delivery-choice statement or "Ya te paso la dirección" → cierre + the payment question', () => {
    for (const t of ['Me sirve más la mensajería privada', 'Ya te paso la dirección', 'Envío a domicilio', 'Retiro con cita', 'Ahí van los datos', 'Prefiero envío a domicilio']) {
      const s = deriveSalesState({ history: QUOTE, inboundText: t, ctx: CTX })
      assert.equal(s.stage, 'cierre', t)
      assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago/, t)
    }
  })

  it('order data after our data request → cierre and the payment question', () => {
    const s = deriveSalesState({ history: ASKED, inboundText: JOSE, ctx: CTX })
    assert.equal(s.stage, 'cierre')
    assert.match(formatSalesTurnBlock(CTX, s), /Pregunta de pago/)
  })

  it('Verifier 2026-11-06 #3: no close on doubts, questions without "?", negations or a first message', () => {
    for (const t of ['Lo voy a pensar', 'Déjeme consultarlo con mi esposo', 'Muy caro', 'Ok gracias', '¿Tienen en color negro?', 'El que me llegó la otra vez venía roto']) {
      assert.notEqual(deriveSalesState({ history: ASKED, inboundText: t, ctx: CTX }).stage, 'cierre', `after ask: ${t}`)
    }
    for (const t of ['Por correos cuánto sale', 'No quiero envío a domicilio', 'Retiro con cita no me sirve', '¿Hacen envío a domicilio?', 'No lo quiero por ahora', 'Mañana te escribo', 'Ya no lo quiero']) {
      assert.notEqual(deriveSalesState({ history: QUOTE, inboundText: t, ctx: CTX }).stage, 'cierre', t)
    }
    assert.equal(deriveSalesState({ history: [], inboundText: 'Hola, hacen envíos a domicilio', ctx: CTX }).stage, 'saludo')
    assert.notEqual(deriveSalesState({ history: ASKED, inboundText: 'Espero la quincena y le aviso', ctx: CTX }).stage, 'cierre')
  })

  it('agents without closeWithPay, or with payment details not shareable, keep the old stage', () => {
    for (const ctx of [{ ...CTX, closeWithPay: false }, { ...CTX, paymentShareable: false }]) {
      assert.notEqual(deriveSalesState({ history: QUOTE, inboundText: 'Me sirve más la mensajería privada', ctx }).stage, 'cierre')
      assert.notEqual(deriveSalesState({ history: ASKED, inboundText: JOSE, ctx }).stage, 'cierre')
    }
  })

  it('payment details already sent → data afterwards waits for the receipt', () => {
    const history = [...QUOTE, msg('inbound', 'Sinpe'), msg('outbound', '💳 Monto: ₡26 900 · SINPE Móvil: 6201 9914 a nombre de Rafael García. Mandame el comprobante 😊'), msg('outbound', DATA_ASK)]
    assert.equal(deriveSalesState({ history, inboundText: JOSE, ctx: CTX }).stage, 'esperando_comprobante')
  })
})

describe('"Quedo a la espera del comprobante": plain data after the payment details (behaviour)', () => {
  const PLAIN = 'Ana Mora Rojas\n88887777\nSan José\nDesamparados\nDel súper 200 sur'
  const llm = (reason: string | null, extra: object = {}) => ({ fallbackUsed: false, toolProblem: false, handoff: reason ? { kind: 'handoff' as const, reason: 'escalate' } : null, escalateReason: reason, ...extra })
  const WAIT = { stage: 'esperando_comprobante' }

  it('only a payment_or_sinpe escalation over plain data at esperando_comprobante becomes the line (gender-neutral)', () => {
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe'), WAIT, PLAIN, false), WAITING_RECEIPT_LINE)
    assert.equal(WAITING_RECEIPT_LINE, '¡Gracias! Quedo a la espera del comprobante 🙌')
  })

  it('Verifier 2026-11-06 #2/#5: payment_claim, other reasons, a receipt cue, a paid chat, fallback, other stages or non-data keep the hand-off', () => {
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_claim'), WAIT, PLAIN, false), null)
    assert.equal(turnDataWhileWaitingReceipt(llm('other'), WAIT, PLAIN, false), null)
    assert.equal(turnDataWhileWaitingReceipt(llm(null), WAIT, PLAIN, false), null)
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe'), WAIT, PLAIN, true), null)
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe'), { ...WAIT, paid: true }, PLAIN, false), null)
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe', { fallbackUsed: true }), WAIT, PLAIN, false), null)
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe', { toolProblem: true }), WAIT, PLAIN, false), null)
    assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe'), { stage: 'cierre' }, PLAIN, false), null)
    for (const t of ['Ana Mora\nTerminé', 'Ana Mora\n88887777\nYa pagué', 'Ana Mora\nde parte de Ana Mora']) {
      assert.equal(turnDataWhileWaitingReceipt(llm('payment_or_sinpe'), WAIT, t, false), null, t)
    }
  })
})
