/**
 * Read a business's own website for "Crear desde fuentes": breadth-first over the same site, ≤20 pages, ≤6 MB in
 * total, ≤60 s, 3 at a time, every request through safeFetch (SSRF-safe). Skips binary/asset links.
 */
import 'server-only'

import { safeFetch, SafeFetchError, validateUrl } from '@/lib/agent-studio/safe-fetch'
import { htmlToText, sameSite } from '@/lib/agent-studio/html-text'

export type CrawledPage = { url: string; title: string; text: string }
export type CrawlResult = { pages: CrawledPage[]; jsonLdProducts: unknown[]; errors: Array<{ url: string; code: string }> }

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|mp4|mp3|mov|avi|css|js|json|xml|woff2?|ttf|eot|docx?|xlsx?|pptx?)(\?|$)/i

export async function crawlSite(
  startUrl: string,
  opts: { maxPages?: number; totalBytes?: number; wallMs?: number; concurrency?: number } = {},
): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 20
  const totalBytes = opts.totalBytes ?? 6_000_000
  const deadline = Date.now() + (opts.wallMs ?? 60_000)
  const concurrency = opts.concurrency ?? 3
  const start = validateUrl(startUrl)
  const host = start.hostname

  const queue: string[] = [start.toString()]
  const seen = new Set<string>(queue)
  const pages: CrawledPage[] = []
  const jsonLdProducts: unknown[] = []
  const errors: Array<{ url: string; code: string }> = []
  let bytes = 0

  // Seed from sitemap.xml when present (same site only).
  try {
    const sm = await safeFetch(new URL('/sitemap.xml', start).toString(), { maxBytes: 500_000, timeoutMs: 8_000 })
    for (const m of sm.body.toString('utf8').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const u = new URL(m[1])
        if (sameSite(u.hostname, host) && !SKIP_EXT.test(u.pathname) && !seen.has(u.toString()) && seen.size < 200) {
          seen.add(u.toString())
          queue.push(u.toString())
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no sitemap */
  }

  async function worker() {
    while (queue.length && pages.length < maxPages && bytes < totalBytes && Date.now() < deadline) {
      const url = queue.shift() as string
      try {
        const res = await safeFetch(url, { maxBytes: 2_000_000, timeoutMs: 10_000 })
        bytes += res.body.length
        const page = htmlToText(res.body.toString('utf8'), res.finalUrl)
        if (page.text.length > 40) pages.push({ url: res.finalUrl, title: page.title, text: page.text })
        jsonLdProducts.push(...page.jsonLdProducts)
        for (const link of page.links) {
          if (seen.size >= 200) break
          if (!seen.has(link) && !SKIP_EXT.test(new URL(link).pathname)) {
            seen.add(link)
            queue.push(link)
          }
        }
      } catch (error) {
        errors.push({ url, code: error instanceof SafeFetchError ? error.code : 'error' })
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return { pages: pages.slice(0, maxPages), jsonLdProducts: jsonLdProducts.slice(0, 100), errors: errors.slice(0, 50) }
}
