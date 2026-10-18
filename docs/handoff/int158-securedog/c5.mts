import { run, U, sc } from './runner.mts'
import { esc } from './harness.mts'
const rev = (s: string) => [...s].reverse().join('')
run({
  'I bidi override (display order differs from logical order)': [
    'Tu pago está ' + U(0x202e) + rev('confirmado') + U(0x202c) + ' ✅',
    U(0x202e) + rev('Pago confirmado') + U(0x202c),
    'Tu pago está ' + U(0x202e) + rev('confirmado'),
    U(0x202e) + rev('Ya confirmamos tu pago'),
    'Tu pedido ' + U(0x202e) + rev('ya fue enviado') + U(0x202c),
  ],
  'J combining marks that NFKC keeps': [
    'Tu pago está confi' + U(0x307) + 'rmado',
    'Tu pago está conf' + U(0x131, 0x307) + 'rmado',
    'Tu pago está confirmad' + 'o' + U(0x323),
    'Tu pago está confirmad' + 'o' + U(0x331),
    'Tu pago está confirmad' + 'o' + U(0x35c),
    'Tu pago está co' + U(0x358) + 'nfirmado',
    'Tu pedido ya fue enviad' + 'o' + U(0x316),
  ],
  'K new sentence-start branch (pedido/orden/compra pagado)': [
    'Pedido pagado ✅', '¡Listo! Pedido pagado ✅', 'Listo, pedido pagado ✅', 'Hola 😊 Pedido pagado', 'Pedido: pagado ✅', 'Orden pagada',
    'Listo 👍 Orden pagada', 'Gracias, compra pagada 🙌', 'Su compra ya pagada, gracias',
  ],
})
for (const t of ['Tu pago está ' + U(0x202e) + rev('confirmado') + U(0x202c)]) console.log('normalized RLO case:', esc(sc.normalizeForConfirmationCheck(t)))
