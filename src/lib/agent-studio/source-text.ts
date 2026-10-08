/**
 * Turn fetched sources into plain text for the extractor (pure; exported for tests). Structured product data
 * (schema.org JSON-LD) becomes short literal lines so prices/variants can be quoted as provenance.
 */
import type { CrawlResult } from '@/lib/agent-studio/web-crawl'

const s = (v: unknown, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '')

export function jsonLdProductLines(products: unknown[]): string[] {
  const lines: string[] = []
  for (const raw of products.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const offersRaw = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : []
    const offers = offersRaw
      .slice(0, 10)
      .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>) : {}))
      .map((o) => [s(o.name, 80), s(o.price ?? o.lowPrice, 20), s(o.priceCurrency, 5), /InStock/i.test(s(o.availability)) ? 'disponible' : /OutOfStock/i.test(s(o.availability)) ? 'agotado' : ''].filter(Boolean).join(' '))
      .filter(Boolean)
    const head = [s(p.name, 160), s(p.sku, 60) && `SKU ${s(p.sku, 60)}`, s(p.category, 80)].filter(Boolean).join(' · ')
    if (head) lines.push(`Producto: ${head}${offers.length ? ` — ${offers.join(' | ')}` : ''}`)
  }
  return lines
}

export function crawlToText(result: CrawlResult): string {
  const parts = result.pages.map((p) => `## ${p.title || p.url}\n(${p.url})\n${p.text}`)
  const products = jsonLdProductLines(result.jsonLdProducts)
  if (products.length) parts.unshift(`## Productos del sitio\n${products.join('\n')}`)
  return parts.join('\n\n').slice(0, 120_000)
}
