/**
 * Verifier wave 2026-10-22 round 3 (lane D): the round-2 security rules without false hand-offs on everyday Spanish —
 * past-tense sentences in earlier bubbles, "ya te pasé mis datos", "cash" / English product names, story bubbles that
 * look like status questions, owner payment blocks, policy lines with "pagado", English brand names / links.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/securedog-wave-d-r3.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPaymentText, hasHardPaymentClaim } from '@/lib/soft-ai/payment-classifier'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { applyFinalOutputPolicy, readsAsForeignLanguage, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import { RESERVED_SHORTCUT_SEEDS } from '@/lib/soft-ai/shortcuts'

const FACTS = parseBrandFacts({
  payment: { shareWithCustomers: true, methods: ['sinpe', 'efectivo'], sinpe: { number: '88880000', holderName: 'Ana Mora' } },
})
const SHORTCUTS = RESERVED_SHORTCUT_SEEDS.map((s, i) => ({ ...s, isActive: true, sortOrder: i }))
const HOLD = new Set(['payment_status_claim', 'confirmation_wording', 'write_claim'])
const reasons = (text: string, customerText: string, paymentContext = false) =>
  validateAgentOutput({ text, citedToolNames: [], modelText: true, customerText, paymentContext }).reasons
const held = (text: string, customerText: string, paymentContext = false) => reasons(text, customerText, paymentContext).some((r) => HOLD.has(r))
const lines = (...b: string[]) => b.join('\n')

describe('r3 #1: ordinary past-tense sentences in an earlier bubble are not a claim', () => {
  it('no hand-off', () => {
    for (const [earlier, latest] of [
      ['Le mandé un mensaje ayer. ¿Tienen el de dormir?', '¿Y el de energía?'],
      ['Pasé por la tienda ayer. ¿Tienen el de dormir?', 'Es para mi mamá'],
      ['Ya me llegó el pedido. ¿Tienen otro color?', 'Me encantó'],
    ]) {
      const d = decideInbound({ inboundText: latest, brandFacts: FACTS, shortcuts: SHORTCUTS, earlierCustomerTexts: [earlier] })
      assert.notEqual(d.paymentClass, 'payment_proof_or_risk', earlier)
    }
    for (const t of ['Hice la consulta ayer. ¿Tienen stock?', 'Ya vi todo. ¿Cuánto es con envío?', 'Me llegó la publicidad. ¿Cuánto cuesta?', 'Le di like a la página. ¿Hacen envíos?', 'Ya tengo todo listo. ¿Me pasás el número?']) {
      assert.equal(hasHardPaymentClaim(t), false, t)
    }
  })
  it('a payment sentence before a question still is', () => {
    for (const t of ['Ya se lo pasé, ¿me avisa?', 'Ya les mandé la plata. ¿Les llegó?', 'Le hice el sinpe ayer. ¿Lo vieron?']) assert.equal(hasHardPaymentClaim(t), true, t)
  })
})

describe('r3 #2: "ya te pasé" only with no object or a money object', () => {
  it('data, photos, addresses are not proof', () => {
    for (const t of ['Ya le pasé la dirección', 'Ya te pasé mis datos', 'Ya le pasé la foto del modelo que quiero', 'Ya se lo pasé a mi esposa para que vea', 'Ya lo pasé a recoger']) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    // Known, pre-existing on the live line (not changed here): as an EARLIER bubble, "Ya te pasé / mandé mis datos" still
    // hands off through the whole-message statement rule (hardClaimIn). Recorded for a later slice.
  })
  it('money is', () => {
    for (const t of ['Ya te pasé la plata', 'Ya se lo pasé ✅', 'Ya le pasé el sinpe', 'Ya les pasé la mitad']) assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })
})

describe('r3 #3: "cash" and English product names are not English payment state', () => {
  it('not a hand-off', () => {
    for (const t of ['¿Aceptan cash?', '¿Tienen el Done Patch?', 'Quiero 2 Done Patch', '¿Tienen papel transfer?', '¿El cargador es fast charge?', '¿Aceptan Apple Pay?', '¿Tienen pay de limón?', '¿Tienen money clip?']) {
      assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['Cash', 'En cash', 'cash porfa']) assert.notEqual(classifyPaymentText(t, { awaitingPaymentMethod: true }), 'payment_proof_or_risk', t)
    const d = decideInbound({ inboundText: '¿Cuánto cuesta?', brandFacts: FACTS, shortcuts: SHORTCUTS, earlierCustomerTexts: ['¿Tienen el Done Patch?'] })
    assert.notEqual(d.paymentClass, 'payment_proof_or_risk')
  })
  it('state shapes still are', () => {
    for (const t of ['Money sent', 'Done, gracias', 'Listo, sent', 'Sent', 'They charged me twice', 'Did the money arrive?', 'I have paid', 'Please confirm my payment']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
  })
})

describe('r3 #4: the wave-D yes / no-question holds need a payment status bubble', () => {
  it('story bubbles are not held', () => {
    for (const [customer, reply] of [
      [lines('Mi hermana lo vio en Instagram', '¿Cuánto cuesta el de dormir?'), '¡Claro! El de dormir está a ₡9.900 😊'],
      [lines('Mi hermana lo vio en Instagram', '¿Tienen el de dormir?'), '¡Claro! Tenemos el de dormir 😊 ¿Te lo aparto?'],
      ['Una amiga lo recibió y le encantó, quiero uno', 'Perfecto 😊 El combo está a ₡22.800.'],
      ['Me dijeron que les llegó mercadería nueva', 'Sí, tenemos stock nuevo de los parches 😊'],
      ['Me dijeron que les llegó mercadería nueva', '¡Claro! ¿Qué producto buscás?'],
      ['¿Te llegó mi mensaje de ayer?', 'Pura vida 😊 ¿En qué te ayudo?'],
      ['¿Te llegó mi mensaje de ayer?', 'Hola 😊 Disculpá la demora.'],
    ]) {
      assert.equal(held(reply, customer, true), false, `${customer} → ${reply}`)
    }
  })
  it('a payment status bubble still holds a yes, even with "un momento"', () => {
    for (const q of [lines('Hola, quiero los parches', '¿Ya está?'), '¿Les llegó?', '¿Lo recibieron?', '¿Les llegó el sinpe que les mandé?']) {
      for (const r of ['¡Sí! Un momento 😊', 'Sí 👍 mi compañera te escribe', 'Sí, perfecto. Un momento.', '¡Claro que sí!']) assert.equal(held(r, q, true), true, `${q} → ${r}`)
    }
  })
})

describe('r3 #5 / #6: owner payment blocks and policy lines', () => {
  it("the owner's efectivo / contra-entrega text is not judged by the model-only checks", () => {
    const facts = parseBrandFacts({
      payment: { shareWithCustomers: true, methods: ['sinpe', 'efectivo'], sinpe: { number: '88880000', holderName: 'Ana Mora' }, efectivo: { text: 'Efectivo exacto, pagado en tienda.' } },
      shipping: { contraEntrega: { enabled: true, text: 'Pagás al recibir. El envío va pagado en el precio, sin problema.' } },
    } as never)
    for (const [text, customerText] of [
      ['¡Perfecto! 🙌\n[[PAGO_CONTRA_ENTREGA]]', 'Pago contra entrega porfa'],
      ['¡Listo! 🙌\n[[PAGO_EFECTIVO]]', 'En efectivo'],
    ]) {
      for (const paymentContext of [false, true]) {
        const p = applyFinalOutputPolicy({ text, modelText: true, skipPurchaseSummary: true, brandFacts: facts, customerText, paymentContext, paymentOptions: { contraEntrega: true } as never })
        assert.equal(p.reasons.includes('payment_status_claim'), false, `${text} ${paymentContext} ${p.reasons}`)
      }
    }
  })
  it('policy lines with "pagado" are not claims', () => {
    for (const r of ['Para apartarlo tiene que estar pagado.', 'Todo pedido pagado hoy sale mañana por Correos.', 'El envío va pagado en el precio.', 'El envío es pagado por el cliente al recibir.', 'El producto se entrega pagado.', '📦 Pedido pagado antes de las 12 md sale el mismo día.']) {
      assert.deepEqual(reasons(r, 'hola'), [], r)
    }
  })
})

const PAY = true
describe('SecureDog r3: status questions, deferrals, look-alikes, third person, more verbs', () => {
  it('#1 short status questions with payment in play hold a yes', () => {
    for (const q of ['Hola, ¿ya está?', 'Listo, ¿ya está?', '¿Ya está? 🙏', '¿Ya está? Gracias', '¿Ya está listo?', '¿Ya está todo bien?', '¿Ya quedó?', '¿Quedó?', '¿Todo bien?', '¿Está bien así?', '¿Entró?', '¿Llegó?', '¿Sí llegó?', '¿Ya pasó?', '¿Salió?', '¿Funcionó?', '¿Ya se reflejó?', '¿Lo tienen?', '¿Y?', '¿Ya?', '¿Listo?', 'Ya te lo envié, ¿todo bien?']) {
      for (const r of ['¡Claro que sí!', '¡Sí!', '👍', '¡Sí! ¿Algo más?']) assert.equal(held(r, q, PAY), true, `${q} → ${r}`)
    }
    // without payment in play, a short question is a sales question
    assert.equal(held('¡Claro! ¿Qué talla buscás?', '¿Lo tienen?'), false)
  })
  it('#2 a done deferral or a filler before the yes is still held', () => {
    for (const r of ['¡Sí! El equipo ya lo confirmó', '¡Sí! Ya lo verificamos', 'Sí, ya lo revisó el equipo', 'Sí, mi compañera ya lo verificó', 'Claro, el equipo ya lo revisó', 'Sí, el equipo ya revisó y está perfecto', 'Mmm sí, ¿algo más?', 'Pues sí', 'Jaja sí', 'Bueno sí', 'Mae sí', '¡Gracias! Sí ¿Algo más?', '¡De una! ¿Algo más?']) {
      assert.equal(held(r, '¿Ya está?', PAY), true, r)
    }
    assert.equal(held('El equipo lo revisa y te confirma por aquí 😊', '¿Ya está?', PAY), false)
  })
  it('#4 Cyrillic look-alikes in the customer text', () => {
    for (const t of ['Yа lе hicе еl sinpе, ¿mе cоnfirmás?', 'Yа lеs pаgué, ¿lо rеcibiеrоn?', 'Yа pаgué ¿tоdо biеn?', 'I pаid']) {
      assert.ok(classifyPaymentText(t) === 'payment_proof_or_risk' || held('¡Claro que sí!', t, PAY), t)
    }
  })
  it('#5 fresh "pagado" sentences are held', () => {
    for (const r of ['Gracias por tu compra con nosotros, todo pagado', 'Si querés te paso la guía, todo pagado', 'Después de revisarlo, todo pagado', 'Con eso queda todo pagado', 'Una vez más gracias, todo pagado', 'Todo pagado ¿Algo más?', '¡Gracias! Todo pagado ¿Te ayudo con algo más?', 'Pagado ¿Querés la guía?', 'Pagado el pedido', 'Pagada la orden', 'Todo pagado hasta hoy', 'Pago completado por completo', 'Pago exitoso ¿Algo más?', 'Cuando revisé ya estaba pagado', 'Si, pagado']) {
      assert.equal(held(r, 'hola'), true, r)
    }
  })
  it('#6 third person with "lo" / "se"', () => {
    for (const r of ['El equipo ya lo confirmó', 'Ya lo confirmaron', 'Lo confirmó el equipo', 'Tu pago lo confirmó el equipo', 'Tu pago se confirmó']) assert.equal(held(r, 'hola'), true, r)
  })
  it('#7 more claim verbs / no-"ya" forms with a time word', () => {
    for (const t of ['Ya te lo envié, ¿lo vieron?', 'Ya lo realicé, ¿quedó?', 'Ya le di, ¿está bien?', 'Te lo envié hace un rato', 'Se lo mandé hace rato', 'Ahorita se lo pasé', 'Te lo acabo de mandar']) {
      assert.equal(classifyPaymentText(t), 'payment_proof_or_risk', t)
    }
    for (const t of ['Ya te envié mis datos', 'Ya le di like a la página', 'Te lo envío ahorita']) assert.notEqual(classifyPaymentText(t), 'payment_proof_or_risk', t)
  })
  it('#3 English / PT / FR', () => {
    for (const c of ['Did it go through?', 'Has it gone through?', 'Is it there?', 'You got it?', 'Arrived?', 'Was it received?', 'Did you guys get it?', 'Confirm pls', 'Can u confirm?', 'All good?', 'Did it work?', 'Check your account', 'Já mandei o dinheiro', 'Enviei o comprovante', 'Chegou?', 'Caiu?', "C'est fait", "J'ai envoyé", "C'est réglé"]) {
      assert.equal(classifyPaymentText(c), 'payment_proof_or_risk', c)
    }
    for (const r of ['Done', 'Confirmed', 'Received', 'Paid', 'Yes, all set!', 'Perfecto, received', 'Tudo certo', "C'est bon", 'Reçu', 'Recebido']) {
      assert.equal(held(r, '¿Ya está?', PAY), true, r)
    }
  })
  it('#8 a combining-mark blank glues no claim', () => {
    const t = ['¿Les', 'llegó?'].join(String.fromCodePoint(0x16fe4))
    assert.ok(classifyPaymentText(t) === 'payment_proof_or_risk' || held('¡Claro que sí!', t, PAY))
  })
})

describe('r3 #8: English brand names and link paths are not the reply language', () => {
  it('not foreign', () => {
    for (const r of ['Thank You Farmer Sun Project a ₡14.900 ✨', 'Mirá: https://tienda.cr/checkout/thank-you-for-your-order', 'It\'s Skin y The Face Shop', 'The Ordinary está a ₡12.000', 'Yes To Tomatoes en stock 😊']) {
      assert.equal(readsAsForeignLanguage(r), false, r)
    }
    assert.equal(readsAsForeignLanguage('Yes, we received it'), true)
    assert.equal(readsAsForeignLanguage('Got it, thanks!'), true)
  })
})
