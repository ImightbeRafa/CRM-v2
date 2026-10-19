/**
 * Products the customer named in one message. Catalog order, one row per product.
 * "glp1" matches "GLP-1". A single product is not a list.
 */
import { productCoreName } from '@/lib/soft-ai/knowledge-coverage'

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

function compact(value: string): string {
  return fold(value).replace(/[\s-]+/g, '')
}

export function productsNamedIn(text: string, catalogNames: readonly string[]): string[] {
  const folded = fold(text || '')
  const squeezed = compact(text || '')
  const out: string[] = []
  const seen = new Set<string>()
  for (const name of catalogNames) {
    const core = productCoreName(name)
    if (core.length < 3) continue
    const key = compact(core)
    if (seen.has(key)) continue
    if (!folded.includes(core) && !squeezed.includes(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}
