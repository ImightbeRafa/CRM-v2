/**
 * Match products seen in the sources to THIS business's inventory items, in code (the model never sees or
 * returns item ids). Exact SKU → normalized name → token overlap with a group (category) bonus.
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
}

function tokens(s: string): Set<string> {
  return new Set(normalizeForMatch(s).split(' ').filter((t) => t.length > 1))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}

/** Pure matcher (exported for tests). */
export function matchProductsAgainst(
  products: Array<{ nameAsSeen: string | null; variantText: string | null; groupText: string | null; priceSeen: number | null }>,
  candidates: InventoryCandidate[],
): ProductMatch[] {
  return products.map((p, index) => {
    const full = [p.nameAsSeen, p.variantText].filter(Boolean).join(' ')
    const want = tokens(full)
    const wantGroup = p.groupText ? normalizeForMatch(p.groupText) : ''
    let best: { c: InventoryCandidate; score: number } | null = null
    for (const c of candidates) {
      let score = 0
      if (c.sku && full && normalizeForMatch(full).split(' ').includes(normalizeForMatch(c.sku))) score = 1
      else if (normalizeForMatch(c.name) === normalizeForMatch(full)) score = 0.98
      else {
        score = jaccard(want, tokens(c.name))
        if (wantGroup && c.category && normalizeForMatch(c.category) === wantGroup) score += 0.1
      }
      if (!best || score > best.score) best = { c, score }
    }
    const matched = best && best.score >= 0.5 ? best.c : null
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
