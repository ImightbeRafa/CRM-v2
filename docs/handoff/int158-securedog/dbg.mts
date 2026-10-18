import { sc, U, inWord } from './runner.mts'
import { esc } from './harness.mts'
import { readFileSync } from 'node:fs'
const src = readFileSync('D:/Coder/CRM-v2-luna2/src/lib/soft-ai/shortcuts.ts', 'utf8')
const line = src.split('\n').find((l) => l.trim().startsWith('/(?<![')) as string
const RE = new RegExp(line.trim().slice(1, line.trim().lastIndexOf('/')), 'iu')
for (const t of [inWord(U(0xfe00)), inWord(U(0x17b4)), ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x3164)), ['Ya', 'confirmamos', 'tu', 'pago'].join(U(0x2800))]) {
  const n = sc.normalizeForConfirmationCheck(t)
  console.log('raw :', esc(t), '->', JSON.stringify(RE.exec(t)?.[0] ?? null))
  console.log('norm:', esc(n), '->', JSON.stringify(RE.exec(n)?.[0] ?? null))
}
console.log('NFKC FE00 len', (U(0xfe00)).normalize('NFKC').length, ' NFKC 3164 len', U(0x3164).normalize('NFKC').length, ' NFKC 2800', U(0x2800).normalize('NFKC').codePointAt(0)?.toString(16))
console.log('Cf test FE00', /\p{Cf}/u.test(U(0xfe00)), ' DI test', /\p{Default_Ignorable_Code_Point}/u.test(U(0xfe00)))
