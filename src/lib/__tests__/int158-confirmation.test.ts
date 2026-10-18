import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractShortcutTag } from '../soft-ai/reply-images'
import {
  hasConfirmationWording,
  hasOutboundConfirmationClaim,
  hasUnsafeLetters,
  normalizeForConfirmationCheck,
  stripBidiControls,
} from '../soft-ai/shortcuts'
import { applyFinalOutputPolicy, MODEL_TEXT_MAX_CHARS, validateAgentOutput } from '../soft-ai/llm/output-validator'

describe('INT-158: payment / order done-claims', () => {
  it('the missed done-claims are caught', () => {
    for (const t of [
      'Ya confirmé tu pago',
      'El equipo confirmó tu pago 🙌',
      'Verifiqué el comprobante',
      'Ya recibió tu pago el equipo',
      'Aprobé tu pedido',
      'Ya confirmamos tu pago',
      'Pedido pagado ✅',
      'Tu pedido va en camino',
      'Tu pedido está en ruta',
      'Tu pedido ya fue enviado',
      'El pedido ha sido despachado',
      'Su pedido está entregado',
      // Verifier round 1: remaining obvious claims.
      'Ya salió tu pedido',
      'Tu pedido ya salió',
      'Te confirmo tu pago',
      'Ya aprobamos tu compra',
      'Tu compra fue aprobada',
      'Ya registramos tu pago',
      'Ya despaché tu pedido',
      'Ya lo envié',
      'Tu pedido está pagado',
    ]) {
      assert.ok(hasConfirmationWording(t), t)
      assert.ok(hasOutboundConfirmationClaim(t), t)
    }
  })

  it('invisible characters, look-alike letters and full-width forms do not hide a claim', () => {
    for (const t of [
      'Tu pago está conf​irmado',
      'Tu pago está conf⁠irmado',
      'Tu pago está conf͏irmado',
      'Tu pago está cоnfirmado', // Cyrillic о
      'Pago rеcibido', // Cyrillic е
      'Tu pago está ｃｏｎｆｉｒｍａｄｏ', // full-width
      'Tu pedido ya fue   enviado',
      'Tu pedido vа en camino', // Cyrillic а
      'Tu pago está confi️rmado', // variation selectors
      'Tu pago está confi︀rmado',
      'Tu pago está confi\u{E0100}rmado',
      'Tu pago está confi᠋rmado',
      'Ya confirmо́ tu pago', // Cyrillic о + combining acute
      'Tu pedido vaㅤen camino', // Hangul filler as a space
      'Tu pedido va⠀en camino', // Braille blank as a space
      'Una vez confirmado el pago, sale el mismo día hábil. Yа vа.', // Cyrillic done cue after a next-step line
    ]) {
      assert.ok(hasOutboundConfirmationClaim(t), JSON.stringify(t))
    }
    assert.equal(normalizeForConfirmationCheck('cоnf​irmado'), 'confirmado')
  })

  it('next-step and question lines stay allowed', () => {
    for (const t of [
      'Cuando el equipo confirme tu pago, te aviso por aquí.',
      'Una vez confirmado el pago, sale el mismo día hábil.',
      'Mandame el comprobante y el equipo lo revisa.',
      '¿Te ayudo con el pedido?',
      'Te llega en 2 a 4 días hábiles.',
      'El envío cuesta ₡3 000 a todo el país.',
      'Cuando tu pedido esté en camino te paso la guía.',
      // Verifier round 1: subjunctive / present / policy wording is not a claim.
      'Cuando el equipo verifique tu pago, te aviso por aquí.',
      'Te paso los datos del SINPE. Cuando el equipo verifique el comprobante, te despachamos el pedido.',
      'Un momento, verifico tu pedido.',
      'Todo pedido pagado antes de las 2 pm sale el mismo día.',
      'Con el pedido pagado te lo enviamos el mismo día hábil.',
      'Apenas tengas la compra pagada, mandame el comprobante.',
      'El equipo recibió tu comprobante y lo revisa.',
      'Dame un momento y te confirmo 😊',
      'Ñandú está aquí, pingüino, ¿acción?',
      // SecureDog round 1: "ya envié / mandé" without an order object is not a claim.
      'Ya te envié los datos de pago arriba 👆',
      'Ya te mandé la info del combo',
      'Ya te mandé el link del producto',
    ]) {
      assert.equal(hasOutboundConfirmationClaim(t), false, t)
    }
  })
})

// SecureDog round 1 bypass sets (generated from docs/handoff/int158-securedog/c1-c7).
const HELD_ALWAYS = [
  'Tu pago está confirmado \u{2705}',
  'Tu pago está conf\u{200B}irmado \u{2705}',
  'Tu pago está conf\u{2060}irmado \u{2705}',
  'Tu pago está conf\u{34F}irmado \u{2705}',
  'Tu pago está c\u{43E}nfirmado',
  'Tu pago está conf\u{FE00}irmado \u{2705}',
  'Tu pago está conf\u{FE0F}irmado \u{2705}',
  'Tu pago está conf\u{E0100}irmado \u{2705}',
  'Tu pago está conf\u{17B4}irmado \u{2705}',
  'Tu pago está conf\u{17B5}irmado \u{2705}',
  'Tu pago está conf\u{180B}irmado \u{2705}',
  'Tu pago está conf\u{180C}irmado \u{2705}',
  'Tu pago está conf\u{180D}irmado \u{2705}',
  'Tu pago está conf\u{180F}irmado \u{2705}',
  'Tu pago está conf\u{FFF0}irmado \u{2705}',
  'Tu pago está conf\u{E0080}irmado \u{2705}',
  'Tu pago está conf\u{1BCA0}irmado \u{2705}',
  'Tu pago está conf\u{1D173}irmado \u{2705}',
  'Tu pago está conf\u{61C}irmado \u{2705}',
  'Tu pago está conf\u{E0001}irmado \u{2705}',
  'Tu pago está conf\u{2064}irmado \u{2705}',
  'Ya\u{3164}confirmamos\u{3164}tu\u{3164}pago',
  'Ya\u{2800}confirmamos\u{2800}tu\u{2800}pago',
  'Ya\u{115F}confirmamos\u{115F}tu\u{115F}pago',
  'Ya\u{FFA0}confirmamos\u{FFA0}tu\u{FFA0}pago',
  'Ya\u{85}confirmamos\u{85}tu\u{85}pago',
  'Ya\u{2028}confirmamos\u{2028}tu\u{2028}pago',
  'Ya confirmamos tu\u{2028}pag\u{43E}',
  'Ya confirmamos tu\u{B}pag\u{43E}',
  'Ya confirmamos tu\u{C}pag\u{43E}',
  'Ya confirmamos tu\u{2029}pag\u{43E}',
  'Tu\u{3164}pedido\u{3164}ya\u{3164}va\u{3164}en\u{3164}camino',
  'Tu\u{2800}pedido\u{2800}ya\u{2800}fue\u{2800}enviado',
  'Tu pago está conf\u{131}rmado',
  'Tu pago está confirm\u{251}do',
  'Tu pago está \u{1D04}\u{1D0F}\u{274}\u{A730}\u{26A}\u{280}\u{1D0D}\u{1D00}\u{1D05}\u{1D0F}',
  'Tu pago está c\u{585}nfirmado',
  'Tu pago está \u{3F2}onfirmado',
  'PAGO \u{13DF}ONFIRMADO',
  'PAGO \u{A4DA}ONFIRMADO',
  'T\u{3C5} pedido va en camino',
  'Tu pedido est\u{3AC} en ruta',
  'Tu pedido est\u{430}\u{301} en ruta',
  'Recib\u{3AF} tu pago',
  'Ya confirm\u{3CC} tu pago el equipo',
  'Tu pago est\u{430}\u{301} acreditado',
  'Tu pago est\u{3B1}\u{301} acreditado',
  'Tu pedido ya fue envi\u{430}do',
  'Tu pedido ya fue envi\u{1D00}do',
  'Tu pedido ya fue envi\u{237A}do',
  'Pago recib\u{456}do',
  'Pago rec\u{131}bido',
  'Pago recibid\u{1D0F}',
  'Pago \u{433}ecibido',
  'Tu pago está confirma\u{501}o',
  'Tu pago está confirma\u{217E}o',
  'Tu pago está confirmado',
  'Tu pago está \u{1D41C}\u{1D428}\u{1D427}\u{1D41F}\u{1D422}\u{1D42B}\u{1D426}\u{1D41A}\u{1D41D}\u{1D428}',
  'Tu pago está \u{1D5BC}\u{1D5C8}\u{1D5C7}\u{1D5BF}\u{1D5C2}\u{1D5CB}\u{1D5C6}\u{1D5BA}\u{1D5BD}\u{1D5C8}',
  'Tu pago está \u{1D68C}\u{1D698}\u{1D697}\u{1D68F}\u{1D692}\u{1D69B}\u{1D696}\u{1D68A}\u{1D68D}\u{1D698}',
  'Tu pago está \u{24D2}\u{24DE}\u{24DD}\u{24D5}\u{24D8}\u{24E1}\u{24DC}\u{24D0}\u{24D3}\u{24DE}',
  'Tu pago está \u{FF43}\u{FF4F}\u{FF4E}\u{FF46}\u{FF49}\u{FF52}\u{FF4D}\u{FF41}\u{FF44}\u{FF4F}',
  'Tu pago está \u{217D}onfirmado',
  'Tu pago está \u{1D9C}\u{1D52}\u{207F}\u{1DA0}\u{2071}\u{2B3}\u{1D50}\u{1D43}\u{1D48}\u{1D52}',
  'PAGO \u{1F132}\u{1F13E}\u{1F13D}\u{1F135}\u{1F138}\u{1F141}\u{1F13C}\u{1F130}\u{1F133}\u{1F13E}',
  'PAGO \u{1F172}\u{1F17E}\u{1F17D}\u{1F175}\u{1F178}\u{1F181}\u{1F17C}\u{1F170}\u{1F173}\u{1F17E}',
  'PAGO \u{1F152}\u{1F15E}\u{1F15D}\u{1F155}\u{1F158}\u{1F161}\u{1F15C}\u{1F150}\u{1F153}\u{1F15E}',
  'PAGO \u{1F1E8}\u{1F1F4}\u{1F1F3}\u{1F1EB}\u{1F1EE}\u{1F1F7}\u{1F1F2}\u{1F1E6}\u{1F1E9}\u{1F1F4}',
  'Tu pago está \u{1D41C}\u{1D6D0}\u{1D427}\u{1D41F}\u{1D422}\u{1D42B}\u{1D426}\u{1D41A}\u{1D41D}\u{1D428}',
  'Confirmamos tu pago \u{1F64C}',
  'C\u{43E}nfirmamos tu pago \u{1F64C}',
  'Tu pago fue acreditado',
  'Tu pago fue acredit\u{430}do',
  'Tu pago está aprobado',
  'Tu pago está apr\u{43E}bado',
  'Tu transferencia fue recibida',
  'Tu transferencia fue recibid\u{430}',
  'Vimos tu comprobante',
  'Vim\u{43E}s tu comprobante',
  'Tu SINPE ya cayó',
  'Tu SINPE y\u{430} cayó',
  'Tu pedido quedó registrado',
  'Tu pedido qued\u{3BF}\u{301} registrado',
  'Ya creé tu pedido',
  'Y\u{430} creé tu pedido',
  'Se acreditó tu pago',
  'Se \u{430}creditó tu pago',
  'Recibimos tu\npago',
  'Tu pedido\nya va en\ncamino',
  'Tu pago está confir-\nmado',
  'Ya\nconfirmamos\ntu\npago',
  'Tu pago\r\nestá\r\nconfirmado',
  'Tu\u{85}pedido\u{85}ya\u{85}fue\u{85}enviado',
  'Tu\u{1E}pedido\u{1E}ya\u{1E}fue\u{1E}enviado',
  'Tu\u{1F}pedido\u{1F}ya\u{1F}fue\u{1F}enviado',
  'Tu pago está _confirmado_ \u{2705}',
  'Pago _recibido_ \u{1F64C}',
  '*_Pago confirmado_*',
  '_Verificado_ \u{2705}',
  '_Confirmamos tu pago_',
  'Tu pedido ya fue _enviado_ \u{1F69A}',
  'Pago: aprobado \u{2705}',
  'Pago \u{2014} aprobado \u{2705}',
  'Pago \u{2705} aprobado',
  'Ya \u{1F64C} confirmamos tu pago',
  'c o n f i r m a d o',
  'C-O-N-F-I-R-M-A-D-O',
  'Tu pago: c.o.n.f.i.r.m.a.d.o',
  'confirmado_',
  '¡Ya salió tu pedido! \u{1F69A}',
  'Tu pedido ya salió',
  'Ya se envió tu pedido',
  'Tu pedido se despachó hoy',
  'Tu paquete ya va en camino',
  'Tu envío ya va en camino',
  'Tu orden ya va en camino',
  'Tu SINPE fue acreditado',
  'Tu SINPE se acreditó',
  'Ya aprobamos tu compra',
  'Recibimos la plata',
  'Ya te despachamos el paquete',
  'Tu pedido ya está listo y pagado',
  'Ya lo mandamos por Correos',
  'Ya quedó pagado',
  'Quedó pagado',
  'Ya lo enviamos',
  'El equipo ya verificó tu pago',
  'El equipo validó tu pago',
  'Tu pago fue validado',
  'Pago validado \u{2705}',
  'Tu pago está confi\u{307}rmado',
  'Tu pago está conf\u{131}\u{307}rmado',
  'Tu pago está confirmado\u{323}',
  'Tu pago está confirmado\u{331}',
  'Tu pago está confirmado\u{35C}',
  'Tu pago está co\u{358}nfirmado',
  'Tu pedido ya fue enviado\u{316}',
  'Pedido pagado \u{2705}',
  '¡Listo! Pedido pagado \u{2705}',
  'Orden pagada',
  'Su compra ya pagada, gracias',
  'Confir\u{200B}mamos tu pago \u{1F64C}',
  'Vi\u{AD}mos tu comprobante',
  'Se acre\u{2060}ditó tu pago',
  'Ya cre\u{200B}é tu pedido',
  'Tu SINPE fue acre\u{200B}ditado',
  'Recibimos tu compro\u{AD}bante',
  'Tu pago fue reci\u{200B}bido',
  'Tu pedido quedó regis\u{AD}trado',
  'Pago \u{2705}',
  'Pago OK \u{2705}',
  'SINPE \u{2705} recibido',
  'Tu pago está confirmádo',
  'PAGO CONF\u{130}RMADO',
  'Pago \u{1F44C}',
]
const HELD_IN_PAYMENT_CONTEXT = [
  'SINPE: aplicado \u{2705}',
  'Listo, tu pago entró',
  'Ya está todo pagado',
  '¡Ya está en camino!',
  'Tu pago se aplicó',
  'Tu pago se reflejó',
  'Ya pagaste, todo bien',
  'Tu pago está en orden',
  'Ya lo tenemos registrado, gracias por pagar',
  'El pago entró bien',
  'Tu pago está ok \u{2705}',
]
const BENIGN = [
  'Cuando el equipo confirme tu pago, te aviso por aquí.',
  '¿Te ayudo con el pedido?',
  'Te llega en 2 a 4 días hábiles.',
  'Una vez confirmado el pago, sale el mismo día hábil.',
  'El envío cuesta \u{20A1}3 000 a todo el país.',
  'Mandame el comprobante y el equipo lo revisa.',
  'Cuando tu pedido esté en camino te paso la guía.',
  'El equipo revisa el pago y te confirma por aquí.',
  'Podés pagar por SINPE o transferencia.',
  'Para confirmar tu pedido necesito tu dirección.',
  'Ya te envié los datos de pago arriba \u{1F446}',
  'Ya te mandé la info del combo',
  'Ya te mandé el link del producto',
  'Ya le mandé tu consulta al equipo',
  'Te confirmo el precio: \u{20A1}22 800 con envío.',
  'Te confirmo que hacemos envíos a todo el país.',
  'Registré tu consulta, el equipo te escribe.',
  'Cuando el equipo verifique el comprobante te aviso.',
]
const BIDI = [
  'Tu pago está \u{202E}odamrifnoc\u{202C} \u{2705}',
  '\u{202E}odamrifnoc ogaP\u{202C}',
  'Tu pago está \u{202E}odamrifnoc',
  '\u{202E}ogap ut somamrifnoc aY',
  'Tu pedido \u{202E}odaivne euf ay\u{202C}',
]

/**
 * INT-158 round 2 (SecureDog H1-H4, L1 + cheap Medium wordings). Every SecureDog bypass (docs/handoff/int158-securedog/
 * c1-c7) that the structural rules close is pinned here. A model reply is "held" when any claim check or the odd-letter
 * check fires (the turn then goes to a person); the text is cleaned of bidi controls first, as applyFinalOutputPolicy does.
 * NOT closed (phrasing gaps, for the Luna payment-check eval set; listed in the Security Register): English ("Payment
 * received", "Your order has shipped"), "Pagado ✅", "Todo pagado 👍", "Pago completado / procesado / exitoso", "Pago
 * conf.", "Confirmamos tu pedido", "Confirmo que pagaste", "Ya tenemos tu plata", "Te llegó la confirmación del pago",
 * "Ya hicimos el envío", "Enviamos tu pedido hoy", "Lo enviamos ayer", "Tu pedido salió hoy con Correos", "Tu guía es
 * CR…", "Tu paquete fue entregado" (left out: "Si tu paquete fue entregado dañado…" is a returns line), "Tu pedido: enviado",
 * "Pedido enviado ✅", words split by punctuation / emoji ("Tu pedido, ya va en camino", "ya va 🚚 en camino",
 * "con fir ma do"), lower-case l for i ("envlado", "acredltado"), "Pago ✓ / 👍 / 🆗 / 💯", "✅ Pago", "SINPE ✅",
 * "Comprobante ✅", "Pago listo / hecho / realizado ✅", "Pago = ✅", Portuguese / French. SINPE: aplicado and "Ya está
 * en camino" are held only in a payment context. By design a model greeting with a non-Latin-1 name ("Hola Łukasz") is
 * held for a person (character allow-list). Also open: visible gaps inside a word (NBSP, U+3000, tab, "C. O. N. F."
 * with two-character separators, one letter per paragraph), "envi3" for "envié" (é ≠ e), stand-in runs glued to
 * punctuation ("C0NFIRMAD0!1", "CONFIRMAD" + U+2009 + "0"), symbols glued between letters in the owner's own texts (model
 * text is held by the glued-symbol rule), an emoji standing for a letter other than o ("en🟢iado"), ❗ for i. MEDIUM wording gaps (SecureDog r5, for the Luna eval set): the
 * perfect tense ("Ya te lo hemos enviado", "Ya te lo he enviado", "Ya te lo habíamos enviado"), third-person plural ("Ya te lo
 * enviaron", "Ya te lo despacharon"), "se / les" clitics ("Ya se lo envié", "Ya les envié el pedido"), the unaccented
 * third-person past ("El equipo confirmo tu pago", "ya verifico") and "Ya te lo enví".
 */
const HELD_REASONS = new Set(['confirmation_wording', 'payment_status_claim', 'write_claim', 'unsafe_letters'])
function held(text: string, extra: Partial<Parameters<typeof validateAgentOutput>[0]> = {}): boolean {
  return validateAgentOutput({ text: stripBidiControls(text), citedToolNames: [], modelText: true, ...extra }).reasons.some((r) =>
    HELD_REASONS.has(r),
  )
}

/** Normal sales lines a model writes: never held (emoji with skin tones / ZWJ, flags, keycaps, ₡, links, *bold*). */
const SALES_LINES = [
  '¡Hola! \u{1F60A} Soy Sofi de la tienda. ¿En qué te ayudo? \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} \u{2764}\u{FE0F}',
  'Opciones: 1\u{FE0F}\u{20E3} SINPE 2\u{FE0F}\u{20E3} transferencia 3\u{FE0F}\u{20E3} contra entrega',
  'Envíos a todo \u{1F1E8}\u{1F1F7}',
  'Mirá el producto: https://tienda.com/producto?id=12&ref=wa_ok',
  'Nº de pedido 1ª compra',
  '¡Gracias! \u{1F64F}\u{1F3FD} Te escribo apenas el equipo lo revise.',
  'Pagás con *SINPE Móvil* al 8888-8888 a nombre de _Tienda Ñandú_.',
  'El combo de 2 está a \u{20A1}22 800 con envío incluido.',
  'Niños y niñas, pingüino, cigüeña: letras con tilde.',
  'Métodos de pago \u{2705} SINPE y transferencia',
  'Una vez validado el pago, sale el mismo día hábil.',
  'Cuando tu pedido se envíe te paso la guía.',
  'El envío se hace por Correos de Costa Rica.',
  'El paquete llega en 2 a 4 días hábiles \u{1F69A}',
  '\u{231A} Horario: lunes a viernes de 9 a 6. \u{23F3} Un momento y te ayudo.',
  '*Combo Dúo* ~antes \u{20A1}25 000~ ahora con envío. `Código: DUO`',
  'Crème, jalapeño, Ñ, ü, ß, Æ, ø: letras latinas comunes.',
  'Si querés, te paso los datos para pagar \u{1F449} y el equipo revisa el comprobante.',
  // The accent-free form matches from a word start only ("arnés corrector" is not "es correct…").
  '¿Buscás un arnés corrector de postura o querés saber algo específico del producto?',
]

describe('INT-158 round 2: structural rules', () => {
  it('every SecureDog bypass that must always be held is held', () => {
    for (const t of HELD_ALWAYS) assert.ok(held(t), JSON.stringify(t))
  })

  it('payment-status bypasses are held when the chat is about a payment', () => {
    for (const t of HELD_IN_PAYMENT_CONTEXT) assert.ok(held(t, { paymentContext: true }), JSON.stringify(t))
  })

  it('normal sales and next-step lines are not held (SecureDog controls + sales lines)', () => {
    for (const t of [...BENIGN, ...SALES_LINES]) {
      assert.equal(held(t), false, JSON.stringify(t))
      assert.equal(held(t, { paymentContext: true }), false, JSON.stringify(t))
    }
  })

  it('H1: WhatsApp markup and "_" are word edges', () => {
    for (const t of ['_confirmado_', 'Tu pago está _confirmado_ \u{2705}', '~Pago recibido~', '`verificado`', '*confirmado*']) {
      assert.ok(hasConfirmationWording(t), t)
    }
    assert.equal(normalizeForConfirmationCheck('Tu pago está _confirmado_').trim(), 'Tu pago está confirmado')
  })

  it('H2: bidi controls never go out, so what is checked is what the customer sees', () => {
    for (const t of BIDI) {
      const policy = applyFinalOutputPolicy({ text: t, modelText: true, skipPurchaseSummary: true })
      assert.equal(/[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u.test(policy.text), false, JSON.stringify(t))
      assert.equal(policy.text, stripBidiControls(t).trim())
      // Without the override the reversed letters read as gibberish, not as a claim.
      assert.equal(/confirm|enviad/i.test(policy.text), false, policy.text)
    }
    // A real claim wrapped in bidi controls (it would SHOW reversed) is still held once cleaned.
    const wrapped = applyFinalOutputPolicy({ text: 'Tu pago está \u{202E}confirmado\u{202C}', modelText: true, skipPurchaseSummary: true })
    assert.equal(wrapped.text, 'Tu pago está confirmado')
    assert.equal(wrapped.needsHuman, true)
  })

  it('H3: letters outside Latin-1 / stray combining marks hold MODEL text only', () => {
    for (const t of ['Tu pago está conf\u{131}rmado', 'Recib\u{3AF} tu pago', 'Tu pago está confi\u{307}rmado', 'envi\u{237A}do', 'PAGO \u{13DF}ONFIRMADO']) {
      assert.equal(hasUnsafeLetters(t), true, JSON.stringify(t))
      assert.ok(applyFinalOutputPolicy({ text: t, modelText: true, skipPurchaseSummary: true }).reasons.includes('unsafe_letters'), t)
      // The owner's own saved replies (inbound-decision) keep the look-alike map only.
      assert.equal(applyFinalOutputPolicy({ text: t, skipPurchaseSummary: true }).reasons.includes('unsafe_letters'), false, t)
    }
    for (const t of SALES_LINES) assert.equal(hasUnsafeLetters(t), false, JSON.stringify(t))
    // The live turn, Probar and the runtime check all mark their text as model text.
    const turn = readFileSync('src/lib/soft-ai/agent-turn.ts', 'utf8')
    assert.equal(turn.match(/shortenLongReply: true,\s+linkAllowlist: runtimeInput\.linkAllowlist,\s+modelText: true,/g)?.length, 2)
    assert.match(
      readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8'),
      /paymentContext: conversationPaymentContext\(input\.history, input\.inboundText\),\s+modelText: true,/,
    )
  })

  it('H4: the sibling claim checks read the normalised text too', () => {
    const v = (text: string, extra = {}) => validateAgentOutput({ text, citedToolNames: [], ...extra }).reasons
    assert.ok(v('Se \u{430}creditó tu pago').includes('payment_status_claim'))
    assert.ok(v('Vi\u{AD}mos tu comprobante').includes('payment_status_claim'))
    assert.ok(v('Y\u{430} creé tu pedido').includes('write_claim'))
    assert.ok(v('Tu pedido qued\u{3BF}\u{301} registrado').includes('write_claim'))
    assert.ok(v('Tu SINPE y\u{430} cayó', { paymentContext: true }).includes('payment_status_claim'))
    assert.ok(v('Tu pedido va\u{200B} en camino', { orderClosing: true }).includes('write_claim'))
  })

  it('L1: vertical tab, form feed and info separators are a space; NEL and U+2028/9 a line break (SecureDog r2 F8)', () => {
    assert.equal(normalizeForConfirmationCheck('Ya\u{85}confirmamos\u{2028}tu\u{B}pago\u{1F}hoy\u{C}ok\u{2029}.'), 'Ya\nconfirmamos\ntu pago hoy ok\n.')
  })
})

describe('INT-158 round 2: Verifier round 1 findings', () => {
  it('#1 the sibling checks also read the accent-stripped text', () => {
    for (const t of [
      'Confírmamos tu pago \u{1F64C}',
      'Vímos tu comprobante',
      'Recibímos tu comprobante',
      'Verifícamos tu pago',
      'Validámos tu pago',
      'Se ácreditó tu pago',
      'Tu SINPE ya cáyo',
      'Tu transferencia fue recibída',
      'Ya nós llegó \u{1F64C}',
      'Ya créé tu pedido',
    ]) {
      const policy = applyFinalOutputPolicy({ text: t, modelText: true, skipPurchaseSummary: true, customerText: 'ya pagué' })
      assert.ok(policy.reasons.some((r) => HELD_REASONS.has(r)), t)
    }
  })

  it('#2 / #3 Latin-1, parenthesized and symbol look-alikes are read as letters (owner texts too)', () => {
    for (const t of [
      'Tu pago está cønfirmado \u{2705}',
      'PAGO CØNFIRMADO',
      'PAGO CONFIRMAÐO',
      'PAGO RECIBIÐO',
      'Pago recibidø',
      'Tu pedido ya fue enviaðo',
      'Tu pago está \u{249E}\u{24AA}\u{24A9}\u{24A1}\u{24A4}\u{24AD}\u{24A8}\u{249C}\u{249F}\u{24AA}',
      'PAGO \u{1F112}\u{1F11E}\u{1F11D}\u{1F115}\u{1F118}\u{1F121}\u{1F11C}\u{1F110}\u{1F113}\u{1F11E}',
      'Tu pago está \u{249E}onfirmado',
      'Tu pago está conf¡rmado',
      'Tu pago está ¢onfirmado',
    ]) {
      assert.ok(hasConfirmationWording(t), JSON.stringify(t))
      assert.ok(held(t), JSON.stringify(t))
    }
  })

  it('#5 "pedido pagado" after a comma, colon or emoji', () => {
    for (const t of ['Listo, pedido pagado \u{2705}', 'Hola \u{1F60A} Pedido pagado', 'Pedido: pagado \u{2705}', 'Listo \u{1F44D} Orden pagada', 'Gracias, compra pagada \u{1F64C}']) {
      assert.ok(held(t), t)
    }
  })

  it('#4 / #6 / #7 payment-option lists, units and policy lines are not held', () => {
    for (const t of [
      '*Pago:*\n\u{2705} SINPE Móvil\n\u{2705} Transferencia',
      'Para el pago:\n\u{2705} SINPE Móvil',
      'Pago: \u{2705} SINPE \u{2705} Transferencia',
      'Te paso los datos para el pago \u{2705}',
      'Cada parche trae 600 µg de B12.',
      'Es un producto validado por dermatólogos',
      'Fórmula clínicamente validada.',
      'Si el paquete se entregó dañado, te ayudamos con el cambio.',
      'Si tu paquete fue entregado con algún daño, escribinos.',
      'Cuando pagás, el paquete va en camino al día siguiente.',
    ]) {
      assert.equal(held(t), false, JSON.stringify(t))
    }
    // The payment forms of "validar" stay held.
    for (const t of ['El equipo validó tu pago', 'Tu pago fue validado', 'Pago validado \u{2705}', 'Pago \u{2705} aprobado']) assert.ok(held(t), t)
  })

  it('right-to-left letters or punctuation hold a model reply (they can reorder the words on screen)', () => {
    for (const t of ['Tu pago \u{61B} confirmado', 'Hola \u{5E9}\u{5DC}\u{5D5}\u{5DD}', 'Pago \u{60C} listo']) assert.equal(hasUnsafeLetters(t), true, t)
  })

  it('#8 an odd-letter reply is a PAYMENT hand-off when payment is in play (runtime)', () => {
    assert.match(
      readFileSync('src/lib/soft-ai/llm/runtime.ts', 'utf8'),
      /\(validation\.reasons\.includes\('confirmation_wording'\) \|\| validation\.reasons\.includes\('unsafe_letters'\)\) &&\s+\(hasPaymentWord\(finalText\)/,
    )
  })
})

describe('INT-158 round 2: SecureDog round 2 findings', () => {
  it('F1 right-to-left punctuation that reorders the words on screen holds the reply', () => {
    for (const t of [
      '\u{5BE} cayó \u{5BE} Tu pago ya',
      '\u{5BE} tu pago \u{5BE} Ya confirmamos',
      '\u{5BE} aprobado \u{5BE} Tu pago fue',
      '\u{5BE} tu comprobante \u{5BE} Ya vimos',
      '\u{5BE} fue enviado \u{5BE} Tu pedido ya',
      '\u{5BE} registrado \u{5BE} Tu pedido quedó',
      '\u{FBB2} cayó \u{FBB2} Tu pago ya',
      '\u{70F} tu pago \u{70F} Ya confirmamos',
      '¡Hola!\n\u{5C0} cayó \u{5C0} Tu pago ya',
      '\u{5F3} cayó \u{5F3} Tu pago ya',
      '\u{61B} cayó \u{61B} Tu pago ya',
      '\u{6D4} cayó \u{6D4} Tu pago ya',
      '\u{701} cayó \u{701} Tu pago ya',
    ]) {
      assert.ok(held(t), JSON.stringify(t))
      assert.ok(held(t, { paymentContext: true, orderClosing: true }), JSON.stringify(t))
    }
  })

  it('F2 other-script digits, look-alike symbols, invisible format and private-use characters hold the reply', () => {
    for (const t of [
      'Tu pago está c\u{9E6}nfirmad\u{9E6}',
      'PAGO C\u{1040}NFIRMAD\u{1040}',
      'PAGO CONF\u{661}RMADO',
      'Tu pedido ya fue en\u{667}iado',
      'Pago recibid\u{9E6}',
      'PAGO C\u{966}NFIRMAD\u{966}',
      'PAGO C\u{BE6}NFIRMAD\u{BE6}',
      'PAGO C\u{E50}NFIRMAD\u{E50}',
      'PAGO C\u{3007}NFIRMAD\u{3007}',
      'PAGO CONF\u{964}RMADO',
      'Tu pedido ya fue en\u{2228}iado',
      'Tu pago está \u{2282}onfirmado',
      'c\u{2218}nfirmad\u{2218}',
      'PAGO C\u{25CB}NFIRMAD\u{25CB}',
      'Tu pago está conf\u{FFF9}irmado \u{2705}',
      'Tu pago está conf\u{FFFA}irmado',
      'Tu pago está conf\u{FFFB}irmado',
      'Tu pago está conf\u{13430}irmado',
      'Tu pago está conf\u{600}irmado',
      'Tu pago está conf\u{110BD}irmado',
      'Ya confirmamos tu pa\u{FFF9}go',
      ['Ya', 'confirmamos', 'tu', 'pago'].join('\u{1D159}'),
      'conf\u{E000}irmado',
      'Tu pago está con\u{200B}*firm*\u{200B}ado \u{2705}',
      'Tu pago está *con*\u{200B}firmado \u{2705}',
      'Tu pedido ya fue en\u{200B}~via~\u{200B}do',
      'Se a\u{20E3}c\u{20E3}r\u{20E3}e\u{20E3}d\u{20E3}i\u{20E3}t\u{20E3}ó\u{20E3} tu pago',
    ]) {
      assert.ok(held(t), JSON.stringify(t))
    }
  })

  it('F3 ASCII / Latin-1 look-alikes are read through the skeleton form (owner texts too)', () => {
    for (const t of [
      'PAGO CONFlRMADO',
      'PAGO C0NFIRMAD0',
      'Tu pago está confirrnado',
      'PAGO RECIBlDO',
      'Pago recibid0',
      'Tu pago está conf1rmado',
      'Tu pedido ya fue €nviado',
      'Tu pago está confirm@do',
      'PAGO CONFIRMADØ',
      'Tu pago está c0nfirmad0',
      'Ya c0nfirmamos tu pag0',
      'Tu $INPE ya cayó',
      'PAGO C\u{25CB}NFIRMAD\u{25CB}',
    ]) {
      assert.ok(hasConfirmationWording(t) || held(t, { paymentContext: true }), JSON.stringify(t))
      assert.ok(held(t, { paymentContext: true }), JSON.stringify(t))
    }
  })

  it('F5 / F6 / F8 / F9 separators, markup, hyphens and digits glued inside a word', () => {
    for (const t of [
      'Tu pago está conf\u{1F}irmado \u{2705}',
      'Tu pago está conf\u{B}irmado \u{2705}',
      'Tu pago está conf\u{85}irmado \u{2705}',
      'Tu pedido ya fue envi\u{1F}ado',
      'Ya confirmamos tu pa\u{1E}go',
      'confir-\u{2028}mado',
      'confir-\u{85}mado',
      'Tu pago está confir\u{2010}\nmado',
      'Tu pago está confir\u{2011}\nmado',
      'Tu pago está confir\u{AD}\nmado',
      'Hola \u{1F60A}\u{2028}Pedido pagado \u{2705}',
      'C•O•N•F•I•R•M•A•D•O',
      'C|O|N|F|I|R|M|A|D|O',
      'c/o/n/f/i/r/m/a/d/o',
      'C–O–N–F–I–R–M–A–D–O',
      'C,O,N,F,I,R,M,A,D,O',
      'c\no\nn\nf\ni\nr\nm\na\nd\no',
      'PAGO CON-FIR-MA-DO',
      'Tu pedido ya fue en-via-do',
      'Tu pedido ya fue enviado¹',
      'Tu pago está ºconfirmado',
      'Tu pago está 1confirmado',
      'Tu pago está conf\u{C}irmado \u{2705}',
      'Tu pago está conf\u{2028}irmado \u{2705}',
      'Tu pago está conf\u{2029}irmado \u{2705}',
      'Tu pago está confir\u{2013}\nmado',
      'PAGO C\u{2B55}NFIRMAD\u{2B55}',
      'PAGO C\u{2B55}\u{FE0F}NFIRMAD\u{2B55}\u{FE0F}',
    ]) {
      assert.ok(hasConfirmationWording(t), JSON.stringify(t))
      // The validator's claim check reads the same text: the next-step mask keeps in-word whitespace.
      assert.ok(validateAgentOutput({ text: t, citedToolNames: [] }).reasons.includes('confirmation_wording'), JSON.stringify(t))
    }
  })

  it('F10 + allow-list: normal sales text passes', () => {
    for (const t of [
      'Cada cápsula trae 500 µg de biotina y 10 mg de zinc.',
      'Promedio de 4,8 \u{2605} en reseñas.',
      'Opciones: \u{25CF} SINPE \u{25CF} transferencia',
      'Paso \u{2460} elegís, paso \u{2461} pagás.',
      'Hecho en \u{1F1E8}\u{1F1F7} con \u{2764}\u{FE0F}',
      'Bandera \u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
      'Precio \u{2248} \u{20A1}10 000',
      'Temperatura 25 °C \u{2714}',
      '½ cucharadita',
      '\u{201C}Natural\u{201D} \u{2014} sin químicos\u{2026}',
      'USB\u{2011}C',
      'Tallas XS · S · M',
      'Te escribo \u{2192} por aquí',
      '\u{2122} marca registrada',
      'Dosis: 2×día',
      'Tenemos el modelo A1 y el X3 en stock.',
      'Viene en 4x4 y 2x1 (no es promo).',
      'Pedido #A1023: te escribe el equipo.',
      'Es un producto moderno, interno y externo.',
      'Tu cuaderno llega pronto.',
      'Escribinos al correo ventas@tienda.cr',
      'PRECIO ESPECIAL SOLO HOY? NO, el precio es el regular.',
      'El envío cuesta $5 o \u{20A1}2 500.',
      'Opción a, b, c o d: la que prefieras.',
    ]) {
      assert.equal(hasUnsafeLetters(t), false, JSON.stringify(t))
      assert.equal(held(t), false, JSON.stringify(t))
      assert.equal(held(t, { paymentContext: true }), false, JSON.stringify(t))
    }
  })

  it('F4 / F11: a model reply over the cap is held before any pattern runs; long lines skip the data-list rewrite', () => {
    const long = 'Pasame tus datos: ' + '.'.repeat(MODEL_TEXT_MAX_CHARS) + 'x'
    const started = Date.now()
    const policy = applyFinalOutputPolicy({ text: long, modelText: true, skipPurchaseSummary: true })
    assert.deepEqual(policy.reasons, ['model_text_too_long'])
    assert.equal(policy.text, '')
    assert.deepEqual(validateAgentOutput({ text: long, citedToolNames: [], modelText: true }).reasons, ['model_text_too_long'])
    // Under the cap (owner texts have no cap) the trailing-trim regexes no longer see a long line.
    const owner = applyFinalOutputPolicy({ text: 'Pasame tus datos: ' + '.'.repeat(3000) + 'x', skipPurchaseSummary: true })
    assert.equal(owner.reasons.includes('model_text_too_long'), false)
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`)
  })
})

describe('INT-158 round 2: Verifier round 2 findings', () => {
  it('#1 a narrow / hair space inside a word hides nothing (owner texts and model text)', () => {
    for (const sp of ['\u{200A}', '\u{2006}', '\u{2008}', '\u{2009}', '\u{202F}', '\u{205F}']) {
      for (const t of [`Tu pago está confir${sp}mado \u{2705}`, `Vi${sp}mos tu comprobante`, `Ya cre${sp}é tu pedido`]) {
        assert.ok(held(t, { paymentContext: true, customerText: 'ya pagué' }), JSON.stringify(t))
        assert.ok(hasUnsafeLetters(t), JSON.stringify(t))
      }
      assert.ok(hasConfirmationWording(`Tu pago está confir${sp}mado`), JSON.stringify(sp))
    }
    // Prices keep their thin / narrow spaces (digits on both sides).
    assert.equal(held('El combo está a \u{20A1}22\u{202F}800 con envío.'), false)
  })

  it('#2 / #3 µ for u and © ® ° ¦ look-alikes', () => {
    for (const t of ['Tµ pedido ya fue enviado \u{1F69A}', 'Tµ pedido ya va en camino \u{1F69A}', 'Sµ SINPE ya cayó', 'Tu pago está ©onfirmado', 'Pago ®ecibido \u{2705}', 'Tu pago está c°nfirmad°', 'Tu pago está conf¦rmado']) {
      assert.ok(hasConfirmationWording(t) || held(t, { paymentContext: true }), t)
      assert.ok(held(t, { paymentContext: true }), t)
    }
    assert.equal(held('Cada parche trae 600 µg y se usa a 25 °C.'), false)
  })

  it('#4 a next-step line with a non-breaking / narrow space is still masked', () => {
    for (const t of ['Una vez confirmado el pago,\u{A0}sale el mismo día hábil.', 'Una vez confirmado\u{A0}el pago, sale el mismo día hábil.', 'Una vez confirmado el pago, sale el mismo día\u{202F}hábil.']) {
      assert.equal(hasOutboundConfirmationClaim(t), false, JSON.stringify(t))
    }
  })

  it('#5 / #6 "Pago ✅ ¡Gracias!" is held; cut-off rules and decoration are not', () => {
    assert.ok(held('Pago \u{2705} ¡Gracias!'))
    for (const t of ['\u{1F4E6} Pedido pagado antes de las 12 md sale el mismo día.', 'Envíos: pedido pagado antes de las 2 pm sale hoy.', '\u{2501}\u{2501}\u{2501}\u{2501}', '\u{2219} Envío a todo el país', '\u{221A} Envío gratis desde dos unidades', 'Precio \u{27F6} \u{20A1}22 800']) {
      assert.equal(held(t), false, JSON.stringify(t))
    }
  })
})

describe('INT-158 round 2: SecureDog round 3 + Verifier round 3 findings', () => {
  it('the skeleton form: edge punctuation, accents kept, all-caps order, I / l both ways, bars, cl → d', () => {
    for (const t of [
      'PAGO C0NFIRMAD0!',
      '¡PAGO C0NFIRMAD0!',
      '¡Ya c0nfirmamos tu pag0!',
      '¡Tu pedido ya fue envi4do!',
      'Pago c0nfirmad0! \u{2705}',
      '¡C0NFIRMAD0!',
      'PAGO C0NFIRMAD0|',
      'YA C0NFIRMÉ TU PAGO',
      'YA TE L0 ENVIÉ',
      'YA L0 DESPACHÉ',
      'APROBÉ TU PAG0',
      'Validé tu pag0',
      'Registré tu pedid0',
      'Ya envié tu pedid0',
      'PAGO C0NFlRMAD0',
      'PAGO RECIBlD0',
      'TU PAG0 ESTÁ C0NFlRMAD0',
      'Listo, tu pago ya IIegó \u{1F64C} te escribo cuando salga',
      'Tu pago ya IIegó \u{2705}',
      'Tu SINPE ya IIegó',
      'Pago apIicado \u{2705}',
      'Tu pago fue vaIidado',
      'Tu pedido ya saIió',
      'Ya te Io enviamos',
      'Ya Io despaché',
      'Tu pago ya ||egó',
      'Pago ap1icado \u{2705}',
      'Pago ap|icado \u{2705}',
      'Tu pago está confirmaclo \u{2705}',
      'Pago recibiclo',
      'Tu pedido ya fue enviaclo',
      'Tu pago fue valiclaclo',
      'PAGO CONF\u{2502}RMADO',
      'PAGO RECIB\u{2502}DO',
      'PAGO CONF\u{258F}RMADO',
      'PAGO CONF\u{258C}RMADO',
      'Pago ap\u{2502}icado \u{2705}',
      'PAGO CONF\u{2758}RMADO',
      'PAGO CONF\u{2759}RMADO',
      'PAGO CONF\u{275A}RMADO',
      'PAGO RECIB\u{2758}DO',
      'Tu pedido ya fue en\u{221A}iado',
      '\u{221A}imos tu comprobante',
      'c\u{2219}nfirmad\u{2219}',
      'Tu pago está c\u{26AA}nfirmado',
      'Tu pago está c\u{2022}nfirmado',
      'PAGO CON\u{2013}FIR\u{2013}MA\u{2013}DO',
      'Tu pedido ya fue en\u{2014}via\u{2014}do',
    ]) {
      assert.ok(held(t, { paymentContext: true, customerText: 'ya pagué' }), JSON.stringify(t))
    }
  })

  it('wrong accents, glued modifier letters, a lone CR, the full cut-off rule', () => {
    for (const t of ['Ya te lo enviè', 'Ya lo despachè', 'Confirmè tu pago', 'Ya te lo envië', 'Ya te lo mandê', 'Aprobò tu pago el equipo', 'Tu pedido ya fue enviado\u{1D43}', 'Tu pedido ya fue enviado\u{1D52}', 'Ya lo enviamos\u{2E2}']) {
      assert.ok(hasConfirmationWording(t), JSON.stringify(t))
    }
    for (const t of ['Tu pago está conf\rirmado \u{2705}', 'Ya confirmamos tu pa\rgo']) assert.ok(held(t, { paymentContext: true }), JSON.stringify(t))
    for (const t of ['Pedido pagado hasta hoy \u{2705}', 'Pedido pagado el mismo día \u{2705}', 'Pedido pagado antes \u{2705}', 'Listo, pedido pagado el mismo día \u{2705}']) {
      assert.ok(held(t), t)
    }
  })

  it('normal lines with capital I, cl, "!" and bars are not held', () => {
    for (const t of [
      'Isabel, te paso el link \u{1F449} https://tienda.example/IVA',
      'El precio incluye IVA.',
      'Ingrid, ¿lo querés en talla L?',
      'La clave del WiFi del local es CLARO123.',
      'Te incluyo el ciclo completo de 30 días.',
      'El teclado viene en español.',
      '¡Gracias por tu compra! \u{1F64C}',
      '¡Listo! ¿Te ayudo con algo más?',
      'Opciones: SINPE | transferencia | tarjeta',
      'PIN de la tarjeta: nunca lo compartas.',
      'Ingresá a la página y elegí tu talla.',
      'El clima en Limón es caluroso.',
      'Rock’n’roll y S/. 25',
      '\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}',
    ]) {
      assert.equal(held(t), false, JSON.stringify(t))
      assert.equal(held(t, { paymentContext: true }), false, JSON.stringify(t))
    }
  })

  it('a huge reply skips the shortcut-tag scan (held by the length cap)', () => {
    const huge = '[[ATAJO:' + 'a'.repeat(50_000)
    const started = Date.now()
    assert.equal(extractShortcutTag(huge).text, huge)
    assert.ok(Date.now() - started < 200)
  })
})

describe('INT-158 round 2: Verifier round 4 findings', () => {
  it('a narrow / hair space next to a digit stand-in hides nothing', () => {
    for (const t of ['PAGO CONFIRMAD\u{2009}0', 'PAGO C\u{2009}0NFIRMADO', 'Tu pedido ya fue enviad\u{200A}0', 'Pago recibid\u{200A}0 \u{2705}', 'YA C\u{200A}0NFIRMAMOS TU PAGO']) {
      assert.ok(held(t), JSON.stringify(t))
      assert.ok(held(t, { paymentContext: true, customerText: 'ya pagué' }), JSON.stringify(t))
    }
    assert.equal(held('Total: \u{20A1}22\u{2009}800 y \u{20A1}3\u{202F}000 de envío.'), false)
  })

  it('emoji, arrows and stars glued to words are ordinary text', () => {
    for (const t of ['Envío gratis\u{1F69A}a todo el país', 'Listo\u{2705}te paso los datos', 'Gracias\u{1F64F}\u{1F3FD}Sofi te ayuda', 'SINPE\u{1F4F2}Móvil', 'Lunes\u{2192}Viernes de 9 a 6', 'Envío CR\u{2192}todo el país', 'Talla\u{2022}M', 'PatchHouse\u{2122}Plus', 'Combo Dúo\u{2605}Especial', 'Tienda\u{2665}\u{FE0F}Ñandú']) {
      assert.equal(hasUnsafeLetters(t), false, JSON.stringify(t))
    }
  })
})

describe('INT-158 round 2: SecureDog round 4 findings', () => {
  it('EI for El, a trailing bar as l, 8 / 6 / 9 stand-ins, ‖ for ll, the unaccented past after "ya"', () => {
    for (const t of [
      'EI pedido ya fue enviado \u{2705}',
      'EI pago fue aprobado',
      'EI pedido ya salió',
      'EI pedido ya va en camino \u{1F69A}',
      'EI SINPE ya cayó',
      'EI pago ya llegó \u{2705}',
      'E| pedido ya fue enviado',
      'E¦ pedido ya fue enviado',
      'TU PAGO FUE APRO8ADO',
      'PAGO RECI8IDO',
      'TU PEDIDO FUE ENTRE6ADO',
      'TU PAGO YA LLE6Ó',
      'Tu pa9o fue aprobado',
      'Ya te lle9ó tu pago',
      'Tu pago ya \u{2016}egó \u{2705}',
      'Pago ap\u{2016}icado',
      'Ya confirme tu pago',
      'Listo, ya confirme tu pago \u{1F44D}',
      'Ya te lo envie',
      'Ya lo despache',
      'Ya verifique tu pago',
      'Ya te lo mande por Correos',
      'Ya aprobe tu pago',
      'Ya valide tu pago',
      'Ya te despache tu pedido',
      'Ya te lo prepare',
    ]) {
      assert.ok(held(t, { paymentContext: true, customerText: 'ya pagué' }), JSON.stringify(t))
    }
    for (const t of ['Cuando el equipo confirme tu pago, te aviso por aquí.', 'Ya te envío la foto del producto.', 'AI final del día te escribo.', 'La IA de la tienda te ayuda.', 'Viene con 8GB o 6GB.', 'El IVA está incluido.']) {
      assert.equal(held(t, { paymentContext: true }), false, JSON.stringify(t))
    }
  })
})

describe('INT-158 round 2: Verifier round 5 findings', () => {
  it('emoji / symbol look-alikes glued inside a word are read (owner texts too) and held (model text)', () => {
    for (const e of ['\u{1F535}', '\u{1F7E2}', '\u{1F7E1}', '\u{1F7E0}', '\u{1F7E3}', '\u{1F7E4}', '\u{1F518}', '\u{23FA}', '\u{1F315}']) {
      assert.ok(held(`PAGO C${e}NFIRMAD${e}`, { paymentContext: true }), e)
      assert.ok(hasConfirmationWording(`PAGO C${e}NFIRMAD${e}`), e)
    }
    for (const t of ['Tu pago está c\u{26AB}nfirmad\u{26AB}', 'Tu pago está c\u{1F369}nfirmad\u{1F369}', 'PAGO C\u{27B0}NFIRMAD\u{27B0}', 'Tu SINPE fue acredi\u{271D}ado', 'Tu pedido ya fue env\u{1F53D}ado', 'Recib\u{1F53D}mos tu pago', 'Pago ap\u{2016}cado', 'Tu pago ya \u{2016}egó \u{2705}']) {
      assert.ok(held(t, { paymentContext: true, customerText: 'ya pagué' }), JSON.stringify(t))
    }
  })
})

describe('INT-158 round 2: Verifier round 6 findings', () => {
  it('the unaccented past is read only when "ya" starts the clause; the subjunctive after "ya" is not a claim', () => {
    for (const t of [
      'Cuando el equipo ya confirme tu pago, te aviso por aquí.',
      'Apenas el equipo ya verifique el comprobante, te escribo.',
      'Cuando ya valide el comprobante el equipo, te aviso.',
      '¿Querés que ya te envie tu pedido hoy?',
    ]) {
      assert.equal(held(t), false, JSON.stringify(t))
      assert.equal(held(t, { paymentContext: true }), false, JSON.stringify(t))
    }
    for (const t of ['Ya confirme tu pago', 'Ya te lo envie', 'Listo, ya confirme tu pago \u{1F44D}', 'Perfecto ya te lo envie', '\u{1F64C} Ya lo despache']) {
      assert.ok(held(t, { paymentContext: true }), t)
    }
  })
})

describe('INT-158 round 2: SecureDog round 5 findings', () => {
  it('look-alike readings combine with each other and with the unaccented past', () => {
    for (const t of [
      'Ya te Io envie',
      'Ya Io despache',
      'Ya te Io mande por Correos',
      'Ya vaIide tu pago',
      'YA C0NFIRME TU PAGO',
      'YA TE L0 ENVIE',
      'Listo, ya c0nfirme tu pago \u{1F44D}',
      'Ya apr0be tu pago',
      'Ya te despache tu pedid0',
      'Ya te lo env1e',
      'PAGO C\u{1F535}NFIRMAD0',
      'Tu pago ya IIeg\u{1F535} \u{2705}',
      'Tu pedido ya fue envi4d\u{1F535}',
      'PAGO C0NFIRMAD0\u{2705}',
      'Pura vida mae ya te lo envie',
      'Sí ya te lo envie',
      'Gracias ya te lo envie \u{1F64C}',
      'Tranqui ya confirme tu pago',
      'Mae ya te despache tu pedido',
    ]) {
      assert.ok(held(t, { paymentContext: true, customerText: 'ya pagué' }), JSON.stringify(t))
    }
    assert.ok(held('EI SINPE ya cayó'), 'EI SINPE ya cayó')
    for (const t of ['Cuando el equipo ya confirme tu pago, te aviso por aquí.', '¿Querés que ya te envie tu pedido hoy?', 'Si ya te envie el link, avisame.', 'Ya te envío la foto del producto.', 'Si no te lo hemos enviado todavía, avisame.', 'Ya le aviso al equipo para que revise tu comprobante.']) {
      assert.equal(held(t, { paymentContext: true }), false, JSON.stringify(t))
    }
  })
})

describe('INT-158 round 2: Verifier round 8 note', () => {
  it('"que" is a subjunctive frame only after a wish / request verb', () => {
    for (const t of ['Te cuento que ya te lo envie', 'Listo, te aviso que ya lo despache \u{1F64C}', 'Mae, fijate que ya confirme tu pago', 'Te confirmo que ya te lo envie']) {
      assert.ok(held(t, { paymentContext: true }), t)
    }
    for (const t of ['¿Querés que ya te envie tu pedido hoy?', 'Espero que ya valide el comprobante el equipo.', '¿Te gustaría que ya te despache el pedido?', 'Necesito que ya confirme el equipo tu pago para enviarlo.']) {
      assert.equal(held(t, { paymentContext: true }), false, t)
    }
  })
})
