import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasConfirmationWording, hasOutboundConfirmationClaim, normalizeForConfirmationCheck } from '../soft-ai/shortcuts'

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
