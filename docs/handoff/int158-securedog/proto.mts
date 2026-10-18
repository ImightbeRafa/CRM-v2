import { sc, U } from './runner.mts'
import { readFileSync } from 'node:fs'
const src = readFileSync('D:/Coder/CRM-v2-luna2/src/lib/soft-ai/shortcuts.ts', 'utf8')
const line = src.split('\n').find((l) => l.trim().startsWith('/(?<![')) as string
const body = line.trim().slice(1, line.trim().lastIndexOf('/'))
const US = String.fromCharCode(95)
const EDGE_RE = new RegExp(body.split('p{N}' + US + ']').join('p{N}]'), 'iu')
const SEP = new RegExp('[' + [0x0b, 0x0c, 0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0x2028, 0x2029].map((c) => U(c)).join('') + ']', 'gu')
const MARKUP = new RegExp('[' + US + '*~`]', 'g')
const KEEP_MARKS = new Set([0x301, 0x303, 0x308])
export function protoNorm(t: string) {
  const pre = (t || '').replace(SEP, ' ').replace(MARKUP, ' ')
  const n = sc.normalizeForConfirmationCheck(pre).normalize('NFD')
  return [...n].filter((c) => !/\p{M}/u.test(c) || KEEP_MARKS.has(c.codePointAt(0)!)).join('').normalize('NFC')
}
import { outboundLettersProblem } from './proto-letters.mts'
export { outboundLettersProblem }
export const protoBlock = (t: string) => Boolean(outboundLettersProblem(t)) || sc.hasOutboundConfirmationClaim(t) || EDGE_RE.test(protoNorm(sc.maskConditionalConfirmation(t)))
