/**
 * Data fences in the prompt (SecureDog INT-103, 2026-10-15). Pure, client-safe.
 * Text that ends up inside a <KNOWLEDGE_DATA> block (approved FAQ, corrections, saved replies, brand facts) must not
 * be able to close the fence or open a fake one — not with spaces ("</ KNOWLEDGE_DATA>"), a space instead of "_",
 * a zero-width or bidi character inside the tag, or a missing ">".
 */

/**
 * Invisible / control characters: C0 controls except tab and line breaks, DEL + C1 (incl. NEL U+0085), soft hyphen,
 * zero-width and direction marks, line / paragraph separators, bidi embeddings and isolates, word joiner and the other
 * invisible operators, BOM, Unicode tag characters (U+E0000–E007F, "ASCII smuggling").
 */
// eslint-disable-next-line no-control-regex
export const FORMAT_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u{AD}\u{200B}-\u{200F}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2060}-\u{206F}\u{FEFF}\u{E0000}-\u{E007F}]/gu

/** NFKC + drop invisible / control characters (tabs and line breaks stay). */
export function stripFormatChars(text: string): string {
  return (text || '').normalize('NFKC').replace(FORMAT_CHARS_RE, '')
}

/** Any opening / closing KNOWLEDGE_DATA tag look-alike, with or without ">" (run after stripFormatChars). */
export const DATA_FENCE_TAG_RE = /<\s*\/?\s*KNOWLEDGE[\s_-]*DATA\b[^>]*>?/gi

/** Body text that sits inside a data fence: no invisible characters, no fence tags, no angle brackets at all. */
export function fenceDataText(text: string): string {
  return stripFormatChars(text)
    .replace(DATA_FENCE_TAG_RE, '[filtrado]')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
}

/** Keep whole lines only, in order, up to `max` characters (a line that does not fit is dropped, never cut). */
export function fitWholeLines(text: string, max: number): string {
  const out: string[] = []
  let used = 0
  for (const line of (text || '').split('\n')) {
    const cost = line.length + (out.length ? 1 : 0)
    if (used + cost > max) continue
    out.push(line)
    used += cost
  }
  return out.join('\n')
}
