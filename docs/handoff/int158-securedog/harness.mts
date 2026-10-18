import { pathToFileURL } from 'node:url'
const ROOT = 'D:/Coder/CRM-v2-luna2/src/lib/soft-ai/'
export async function load() {
  const sc = await import(pathToFileURL(ROOT + 'shortcuts.ts').href)
  const ov = await import(pathToFileURL(ROOT + 'llm/output-validator.ts').href)
  return { sc, ov }
}
export function esc(s: string) {
  return [...s].map((c) => { const cp = c.codePointAt(0)!; return (cp > 0x7e && cp !== 0xe1 && cp !== 0xe9 && cp !== 0xed && cp !== 0xf3 && cp !== 0xfa && cp !== 0xf1 && cp !== 0xbf && cp !== 0xa1) || cp < 0x20 ? '<U+' + cp.toString(16).toUpperCase() + '>' : c }).join('')
}
