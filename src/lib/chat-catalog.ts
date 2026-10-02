/**
 * Catalog in chat (human composer): pure helpers. The picker inserts editable text — the person
 * reads it and presses send; nothing is sent automatically. Never includes cost or supplier data.
 */

export type CatalogItem = {
  id: string
  name: string
  sku: string | null
  category: string | null
  sellingPrice: number
  currentStock: number
  minStock: number
}

export function stockPhrase(item: Pick<CatalogItem, 'currentStock' | 'minStock'>): string | null {
  if (item.currentStock <= 0) return 'Agotado por ahora'
  if (item.currentStock <= Math.max(0, item.minStock)) return 'Pocas unidades'
  return null
}

export function formatColones(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0)
  return `₡${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/** "Kit Básico — ₡27 000 (Pocas unidades)". Sellable text only. */
export function formatCatalogSnippet(item: CatalogItem): string {
  const stock = stockPhrase(item)
  return `${item.name} — ${formatColones(item.sellingPrice)}${stock ? ` (${stock})` : ''}`
}

export function parseCatalogQuery(raw: string | null | undefined): string {
  return (raw || '').trim().slice(0, 60)
}

export function clampCatalogLimit(raw: string | null | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 15
  return Math.min(25, Math.floor(n))
}
