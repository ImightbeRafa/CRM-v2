const BIDI = /[\u202A-\u202E\u2066-\u2069]/u
const OK_LETTER = /^[A-Za-z\u00AA\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]$/u
export function outboundLettersProblem(t: string) {
  if (BIDI.test(t)) return 'bidi'
  for (const c of (t || '').normalize('NFKC').normalize('NFC')) {
    const cp = c.codePointAt(0)!
    const emojiSel = (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x20e3
    if (/\p{L}/u.test(c) && !OK_LETTER.test(c)) return 'letter ' + cp.toString(16)
    if (/\p{M}/u.test(c) && !emojiSel) return 'mark ' + cp.toString(16)
  }
  return null
}
