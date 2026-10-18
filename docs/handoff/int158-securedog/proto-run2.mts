import { U } from './runner.mts'
import { protoBlock, outboundLettersProblem } from './proto.mts'
import { esc } from './harness.mts'
const benign = [
  '¡Hola! 😊 Soy Sofi de la tienda. ¿En qué te ayudo? 👨‍👩‍👧 ❤️', 'Opciones: 1️⃣ SINPE 2️⃣ transferencia 3️⃣ contra entrega', 'Envíos a todo 🇨🇷',
  'Mirá el producto: https://tienda.com/producto?id=12&ref=wa', 'Nº de pedido 1ª compra', '¡Gracias! 🙏🏽 Te escribo apenas el equipo lo revise.',
  'Pagás con *SINPE Móvil* al 8888-8888 a nombre de _Tienda Ñandú_.',
]
for (const t of benign) { const b = protoBlock(t); console.log((b ? 'FALSE+' : 'ok    ') + ' | ' + esc(t) + (b ? '  (' + outboundLettersProblem(t) + ')' : '')) }
