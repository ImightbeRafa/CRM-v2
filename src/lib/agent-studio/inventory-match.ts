/**
 * Match products seen in the sources to THIS business's inventory items, in code (the model never sees or
 * returns item ids). Exact SKU → normalized name → token overlap (typo-tolerant) with a group (category) bonus.
 * When no single item fits but the closest ones share a category, the whole group is suggested.
 * Prices are never written: a different price is only shown to the owner as a warning.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { normalizeForMatch } from '@/lib/agent-studio/provenance'

export type InventoryCandidate = { id: string; name: string; sku: string | null; category: string | null; sellingPrice: number; currentStock: number }
export type ProductMatch = {
  index: number
  itemId: string | null
  itemName: string | null
  category: string | null
  score: number
  priceSeen: number | null
  priceInInventory: number | null
  priceDiffers: boolean
  /** No single item fits (e.g. "Arnés Forge" with no size) but all the closest ones share a category: offer the group. */
  group: { category: string; itemIds: string[] } | null
}

/** Doubled letters collapsed ("ARNESS" ≈ "Arnés"): common typos in inventory names. */
function canon(t: string): string {
  return t.replace(/(\p{L})\1+/gu, '$1')
}

function tokens(s: string): Set<string> {
  // Single letters/digits stay: sizes (S / M / L, 2 / 4) are what tell variants apart.
  return new Set(normalizeForMatch(s).split(' ').filter(Boolean).map(canon))
}

/** Same word, allowing one typo (edit distance ≤ 1) for words of 5+ letters. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1
      j += 1
      continue
    }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else {
      i += 1
      j += 1
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  const bs = [...b]
  let inter = 0
  for (const t of a) if (bs.some((u) => sameWord(t, u))) inter += 1
  return inter / (a.size + b.size - inter)
}

/** Pure matcher (exported for tests). */
export function matchProductsAgainst(
  products: Array<{ nameAsSeen: string | null; variantText: string | null; groupText: string | null; priceSeen: number | null; skuSeen?: string | null }>,
  candidates: InventoryCandidate[],
): ProductMatch[] {
  return products.map((p, index) => {
    const full = [p.nameAsSeen, p.variantText].filter(Boolean).join(' ')
    const want = tokens(full)
    const wantGroup = p.groupText ? tokens(p.groupText) : null
    const sku = p.skuSeen ? normalizeForMatch(p.skuSeen) : ''
    let best: { c: InventoryCandidate; score: number } | null = null
    let tie = false
    const scored: Array<{ c: InventoryCandidate; score: number }> = []
    for (const c of candidates) {
      let score = 0
      // Exact SKU the source wrote > SKU inside the name as a whole-word sequence ("AF-XL" → "af xl") > names.
      if (sku && c.sku && normalizeForMatch(c.sku) === sku) score = 1.01
      else if (c.sku && full && normalizeForMatch(c.sku) && ` ${normalizeForMatch(full)} `.includes(` ${normalizeForMatch(c.sku)} `)) score = 1
      else if (normalizeForMatch(c.name) === normalizeForMatch(full)) score = 0.98
      else {
        score = jaccard(want, tokens(c.name))
        if (wantGroup && c.category && jaccard(wantGroup, tokens(c.category)) >= 0.99) score += 0.1
      }
      scored.push({ c, score })
      if (!best || score > best.score + 1e-9) {
        best = { c, score }
        tie = false
      } else if (Math.abs(score - best.score) <= 1e-9) tie = true
    }
    // Two items equally good (e.g. sizes the source did not name): leave it for the owner to pick.
    const matched = best && best.score >= 0.5 && !tie ? best.c : null
    let group: ProductMatch['group'] = null
    if (!matched && best && best.score >= 0.3) {
      const top = best.score
      const close = scored.filter((x) => x.score >= top - 0.15)
      const cats = new Set(close.map((x) => (x.c.category || '').trim()))
      const category = [...cats][0]
      if (cats.size === 1 && category) {
        group = { category, itemIds: candidates.filter((c) => (c.category || '').trim() === category).map((c) => c.id) }
      }
    }
    const priceInInventory = matched ? matched.sellingPrice : null
    return {
      index,
      itemId: matched?.id ?? null,
      itemName: matched?.name ?? null,
      category: matched?.category ?? null,
      score: Math.round((best?.score ?? 0) * 100) / 100,
      priceSeen: p.priceSeen,
      priceInInventory,
      priceDiffers: Boolean(matched && p.priceSeen && priceInInventory && Math.abs(p.priceSeen - priceInInventory) >= 1),
      group,
    }
  })
}

export async function matchProducts(
  tenantId: string,
  products: Parameters<typeof matchProductsAgainst>[0],
): Promise<ProductMatch[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, sku: true, category: true, sellingPrice: true, currentStock: true },
    orderBy: { name: 'asc' },
    take: 400,
  })
  return matchProductsAgainst(
    products,
    items.map((i) => ({ ...i, sellingPrice: Number(i.sellingPrice), currentStock: Number(i.currentStock) })),
  )
}
