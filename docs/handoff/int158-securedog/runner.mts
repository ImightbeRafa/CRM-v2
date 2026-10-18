import { load, esc } from './harness.mts'
export const { sc, ov } = await load()
export const U = (...cps: number[]) => String.fromCodePoint(...cps)
const CLAIM = new Set(['confirmation_wording', 'payment_status_claim', 'write_claim'])
const claims = (input: any) => ov.validateAgentOutput(input).reasons.filter((r: string) => CLAIM.has(r)).length > 0
export function verdicts(t: string) {
  return {
    R: sc.hasConfirmationWording(t) as boolean,
    O: sc.hasOutboundConfirmationClaim(t) as boolean,
    V0: claims({ text: t, citedToolNames: [] }),
    VP: claims({ text: t, citedToolNames: [], paymentContext: true }),
    VC: claims({ text: t, citedToolNames: [], paymentContext: true, orderClosing: true }),
  }
}
const b = (x: boolean) => (x ? 'BLOCK' : 'pass ')
export function run(groups: Record<string, string[]>) {
  for (const [g, list] of Object.entries(groups)) {
    console.log('\n=== ' + g)
    for (const t of list) {
      const v = verdicts(t)
      const flag = !v.VP ? '  <== SENDS (even w/ payment ctx)' : !v.V0 ? '  <- sends w/o payment ctx' : !v.O ? '  (check misses; sibling catches)' : ''
      console.log('R=' + b(v.R) + ' O=' + b(v.O) + ' V0=' + b(v.V0) + ' VP=' + b(v.VP) + ' VC=' + b(v.VC) + ' | ' + esc(t) + flag)
    }
  }
}
export const ins = (w: string, at: number, ch: string) => w.slice(0, at) + ch + w.slice(at)
export const inWord = (ch: string) => 'Tu pago está ' + ins('confirmado', 4, ch) + ' ✅'
