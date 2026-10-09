/**
 * Match products seen in the sources to THIS business's inventory items, in code (the model never sees or
 * returns item ids). Exact SKU → normalized name → token overlap (typo-tolerant) with a group (category) bonus.
 * When no single item fits but the closest ones share a category, the whole group is suggested.
 * Prices are never written: a different price is only shown to the owner as a warning.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { normalizeForMatch } from '@/lib/agent-studio/provenance'
import { wordSimilarity } from '@/lib/product-words'

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

/** Pure matcher (exported for tests). */
export function matchProductsAgainst(
  products: Array<{ nameAsSeen: string | null; variantText: string | null; groupText: string | null; priceSeen: number | null; skuSeen?: string | null }>,
  candidates: InventoryCandidate[],
): ProductMatch[] {
  return products.map((p, index) => {
    const full = [p.nameAsSeen, p.variantText].filter(Boolean).join(' ')
    const wantGroup = p.groupText || ''
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
        // Shared word matcher: accents / small typos tolerated, sizes exact (XXL ≠ XL); always < 0.98 unless exact.
        const bonus = wantGroup && c.category && wordSimilarity(wantGroup, c.category) >= 0.9 ? 0.1 : 0
        score = Math.min(wordSimilarity(full, c.name) + bonus, 0.97)
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
