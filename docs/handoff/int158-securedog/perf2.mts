import { sc, ov, U } from './runner.mts'
const fill = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n)
const time = (f: () => unknown) => { const t0 = performance.now(); f(); return performance.now() - t0 }
for (const n of [1500, 4000, 10000, 20000, 40000, 65000]) {
  const t = 'Tu pago ' + fill(U(0x316, 0x301), n)
  const nf = time(() => t.normalize('NFKC'))
  const O = time(() => sc.hasOutboundConfirmationClaim(t))
  const V = time(() => ov.validateAgentOutput({ text: t, citedToolNames: [], paymentContext: true }))
  console.log(String(n).padStart(6), 'rawNFKC=' + nf.toFixed(1), 'O=' + O.toFixed(1), 'V=' + V.toFixed(1))
}
