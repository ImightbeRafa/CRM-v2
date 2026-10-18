import { U } from './runner.mts'
import { protoBlock, outboundLettersProblem } from './proto.mts'
import { esc } from './harness.mts'
const rev = (s: string) => [...s].reverse().join('')
const attacks = [
  'Tu pago está _confirmado_ ✅', '_Verificado_ ✅', 'Tu pedido ya fue _enviado_ 🚚',
  'Tu pago está ' + U(0x202e) + rev('confirmado') + U(0x202c) + ' ✅',
  'Tu pago está conf' + U(0x131) + 'rmado', 'Tu pago está confirm' + U(0x251) + 'do', 'Tu pago está c' + U(0x585) + 'nfirmado',
  'Tu pago está ' + U(0x3f2) + 'onfirmado', 'PAGO ' + U(0x13df) + 'ONFIRMADO', 'T' + U(0x3c5) + ' pedido va en camino',
  'Tu pedido est' + U(0x3ac) + ' en ruta', 'Recib' + U(0x3af) + ' tu pago', 'Tu pago está confi' + U(0x307) + 'rmado',
  'C' + U(0x43e) + 'nfirmamos tu pago', 'Vim' + U(0x43e) + 's tu comprobante', 'Y' + U(0x430) + ' creé tu pedido',
  ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x85)), 'Tu pago está co' + U(0x358) + 'nfirmado',
]
const benign = [
  'Cuando el equipo confirme tu pago, te aviso por aquí.', '¿Te ayudo con el pedido?', 'Te llega en 2 a 4 días hábiles.',
  'Una vez confirmado el pago, sale el mismo día hábil.', 'El envío cuesta ₡3 000 a todo el país.', 'Mandame el comprobante y el equipo lo revisa.',
  'Cuando tu pedido esté en camino te paso la guía.', '¡Hola! 😊 Soy Sofi de la tienda. ¿En qué te ayudo? 👨‍👩‍👧 ❤️', 'Pagás con *SINPE Móvil* al 8888-8888 a nombre de _Tienda Ñandú_.',
  'El combo de 2 está a ₡22 800 con envío incluido.', 'Niños y niñas, pingüino, cigüeña: todo bien.',
]
let miss = 0
for (const t of attacks) { const b = protoBlock(t); if (!b) miss++; console.log((b ? 'BLOCK' : 'MISS ') + ' attack | ' + esc(t)) }
let fp = 0
for (const t of benign) { const b = protoBlock(t); if (b) fp++; console.log((b ? 'FALSE+' : 'ok    ') + ' benign | ' + esc(t) + (b ? '  (' + outboundLettersProblem(t) + ')' : '')) }
console.log('attacks missed:', miss, '/', attacks.length, ' benign blocked:', fp, '/', benign.length)
