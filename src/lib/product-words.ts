/**
 * Word-level product matching shared by the agent's live product search and the Studio matcher.
 * Accents / case / punctuation ignored; words of 5+ letters tolerate one typo and doubled letters
 * ("ARNESS" ≈ "Arnés"); short words — sizes like XL / XXL / 2XL / M — must match exactly.
 * Pure (no DB, no server-only).
 */

export function normalizeWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** Doubled letters collapsed — only for long words, never sizes ("xxl" stays "xxl"). */
function canon(w: string): string {
  return w.length >= 5 ? w.replace(/(\p{L})\1+/gu, '$1') : w
}

/** Same word: exact, or (5+ letters) same after collapsing doubles, or one typo apart. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5) return false
  const x = canon(a)
  const y = canon(b)
  if (x === y) return true
  if (Math.abs(x.length - y.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (x.length > y.length) i += 1
    else if (y.length > x.length) j += 1
    else {
      i += 1
      j += 1
    }
  }
  return edits + (x.length - i) + (y.length - j) <= 1
}

/**
 * One-to-one word matches between two word lists (each word used once). Exact matches count 1, fuzzy 0.9,
 * so an exact name always outranks a typo-tolerant one.
 */
export function matchedWeight(a: string[], b: string[]): number {
  const used = new Set<number>()
  let total = 0
  for (const w of a) {
    let exact = -1
    let fuzzy = -1
    for (let k = 0; k < b.length; k += 1) {
      if (used.has(k)) continue
      if (b[k] === w) {
        exact = k
        break
      }
      if (fuzzy < 0 && sameWord(w, b[k])) fuzzy = k
    }
    if (exact >= 0) {
      used.add(exact)
      total += 1
    } else if (fuzzy >= 0) {
      used.add(fuzzy)
      total += 0.9
    }
  }
  return total
}

/** Jaccard-style similarity in [0, 1] on unique words. */
export function wordSimilarity(a: string, b: string): number {
  const x = [...new Set(normalizeWords(a))]
  const y = [...new Set(normalizeWords(b))]
  if (!x.length || !y.length) return 0
  const inter = matchedWeight(x, y)
  return inter / (x.length + y.length - inter)
}

const FILLER = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'con', 'y', 'en', 'precio', 'precios', 'cuanto', 'cuesta', 'vale', 'talla', 'tallas', 'hay', 'tienen', 'tiene', 'quiero'])

/**
 * How well a customer's search words fit a product (name + category + sku): share of the meaningful query words
 * found in the product. 0 when nothing but filler matches.
 */
export function queryFit(query: string, productText: string): number {
  const q = [...new Set(normalizeWords(query))].filter((w) => !FILLER.has(w))
  if (!q.length) return 0
  const p = normalizeWords(productText)
  return matchedWeight(q, p) / q.length
}
