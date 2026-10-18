import { run, U } from './runner.mts'
const z = U(0x200b), sh = U(0xad), wj = U(0x2060)
run({
  'L invisible chars inside sibling-only phrases': [
    'Confir' + z + 'mamos tu pago 🙌', 'Vi' + sh + 'mos tu comprobante', 'Se acre' + wj + 'ditó tu pago', 'Ya cre' + z + 'é tu pedido',
    'Tu SINPE fue acre' + z + 'ditado', 'Recibimos tu compro' + sh + 'bante', 'Tu pago fue reci' + z + 'bido', 'Tu pedido quedó regis' + sh + 'trado',
  ],
  'M misc': ['Pago ✅', 'Pago OK ✅', 'SINPE ✅ recibido', 'Tu pago está confirmádo', 'PAGO CONF' + U(0x130) + 'RMADO', 'Pago conf.', 'Pago 👌'],
})
