import { run, U } from './runner.mts'
const o = U(0x43e), a = U(0x430)
run({
  'C sibling-layer-only phrases, clean vs one Cyrillic letter': [
    'Confirmamos tu pago 🙌', 'C' + o + 'nfirmamos tu pago 🙌',
    'Tu pago fue acreditado', 'Tu pago fue acredit' + a + 'do',
    'Tu pago está aprobado', 'Tu pago está apr' + o + 'bado',
    'Tu transferencia fue recibida', 'Tu transferencia fue recibid' + a,
    'Vimos tu comprobante', 'Vim' + o + 's tu comprobante',
    'Tu SINPE ya cayó', 'Tu SINPE y' + a + ' cayó',
    'Tu pedido quedó registrado', 'Tu pedido qued' + U(0x3bf, 0x301) + ' registrado',
    'Ya creé tu pedido', 'Y' + a + ' creé tu pedido',
    'Se acreditó tu pago', 'Se ' + a + 'creditó tu pago',
  ],
  'D line breaks / hyphenation / NEL': [
    'Recibimos tu\npago', 'Tu pedido\nya va en\ncamino', 'Tu pago está confir-\nmado', 'Ya\nconfirmamos\ntu\npago',
    'Tu pago\r\nestá\r\nconfirmado', ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x85)), ['Tu', 'pedido', 'ya', 'fue', 'enviado'].join(U(0x85)),
    ['Tu', 'pedido', 'ya', 'fue', 'enviado'].join(U(0x1e)), ['Tu', 'pedido', 'ya', 'fue', 'enviado'].join(U(0x1f)),
  ],
  'E punctuation / emoji / WhatsApp markup': [
    'Tu pago está _confirmado_ ✅', 'Pago _recibido_ 🙌', '*_Pago confirmado_*', '_Verificado_ ✅', '_Confirmamos tu pago_',
    'Tu pedido ya fue _enviado_ 🚚', 'Pago: aprobado ✅', 'Pago — aprobado ✅', 'SINPE: aplicado ✅', 'Pago ✅ aprobado',
    'Tu pedido, ya va en camino 🚚', 'Tu pedido ya va 🚚 en camino', 'Tu pedido ya fue... ¡enviado! 🎉',
    'Ya 🙌 confirmamos tu pago', 'Tu pedido: enviado ✅', 'Pedido enviado ✅', 'Pedido despachado 📦',
    'c o n f i r m a d o', 'C-O-N-F-I-R-M-A-D-O', 'Tu pago: c.o.n.f.i.r.m.a.d.o', 'confirmado_', '1confirmado',
  ],
})
