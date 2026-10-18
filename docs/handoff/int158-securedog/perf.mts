import { sc, ov, U } from './runner.mts'
const fill = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
const gens: Record<string, (n: number) => string> = {
  'ya+spaces': (n) => 'ya' + fill(' ', n) + 'x',
  'ya+newlines': (n) => 'ya' + fill('\n', n) + 'x',
  'ya+3164': (n) => 'ya' + fill(U(0x3164), n) + 'x',
  'ya+2800': (n) => 'ya' + fill(U(0x2800), n) + 'x',
  'ya+NBSP': (n) => 'ya' + fill(U(0xa0), n) + 'x',
  'ya+FE00': (n) => 'ya ' + fill(U(0xfe00), n) + 'x',
  '"ya " rep': (n) => fill('ya ', n),
  '"ya\n" rep': (n) => fill('ya\n', n),
  '"ya te lo " rep': (n) => fill('ya te lo ', n),
  '"tu pedido ya " rep': (n) => fill('tu pedido ya ', n),
  '"tu pedido ya fue " rep': (n) => fill('tu pedido ya fue ', n),
  '". pedido " rep': (n) => fill('.\n pedido ', n),
  '"recibimos tu " rep': (n) => fill('recibimos tu ', n),
  'cyrillic o run': (n) => fill(U(0x43e), n),
  'combining 0301/0316': (n) => 'a' + fill(U(0x301, 0x316), n),
  'combining 0316/0301': (n) => 'a' + fill(U(0x316, 0x301), n),
  'FDFA expansion': (n) => fill(U(0xfdfa), n),
  'long word': (n) => fill('a', n),
  'está + long word': (n) => 'Una vez confirmado el pago, sale hoy. está ' + fill('a', n) + 'x',
  'mask + long rest': (n) => 'Una vez confirmado el pago, sale hoy. ' + fill('ya hemos ', n),
  'mask + many next-steps': (n) => fill('Una vez confirmado el pago, sale el mismo día hábil. ', n),
  'dots': (n) => fill('. ', n),
  'tabs+CR': (n) => 'ya' + fill(' \t\r', n) + 'x',
  'mixed ws all kinds': (n) => 'tu' + fill(' ' + U(0x3164) + '\t' + U(0x2800) + U(0xa0) + '\n', n) + 'pedido',
}
const time = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0 }
for (const n of [4000, 10000]) {
  let worst = { k: '', fn: '', ms: 0 }
  for (const [k, g] of Object.entries(gens)) {
    const t = g(n)
    const r = {
      norm: time(() => sc.normalizeForConfirmationCheck(t)),
      R: time(() => sc.hasConfirmationWording(t)),
      O: time(() => sc.hasOutboundConfirmationClaim(t)),
      V: time(() => ov.validateAgentOutput({ text: t, citedToolNames: [], paymentContext: true, orderClosing: true })),
    }
    for (const [fn, ms] of Object.entries(r)) if (ms > worst.ms) worst = { k, fn, ms }
    console.log(String(n).padStart(5), k.padEnd(26), Object.entries(r).map(([a, b]) => a + '=' + b.toFixed(1)).join(' '))
  }
  console.log('WORST at', n, ':', worst.k, worst.fn, worst.ms.toFixed(1) + ' ms')
}
