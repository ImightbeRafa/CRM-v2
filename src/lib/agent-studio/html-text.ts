/**
 * HTML → readable text for "Crear desde fuentes" (no dependencies). Drops scripts, styles, svg, templates,
 * nav chrome noise; keeps title, meta description / og tags, JSON-LD Product data, headings and paragraphs, and
 * same-host links for the crawler. Output is DATA for the extractor, never instructions.
 */

const MAX_CHARS = 300_000

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó',
  uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü',
  iexcl: '¡', iquest: '¿', copy: '©', reg: '®', deg: '°', middot: '·', ndash: '–', mdash: '—', hellip: '…',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[code] ?? m
  })
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null
}

export type HtmlExtract = { title: string; text: string; links: string[]; jsonLdProducts: unknown[] }

export function htmlToText(html: string, baseUrl: string): HtmlExtract {
  const src = html.slice(0, 3_000_000)
  const title = decodeEntities((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 200)

  const metas: string[] = []
  for (const m of src.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    const key = (attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase()
    if (/^(description|og:title|og:description|product:price:amount|product:price:currency|og:site_name)$/.test(key)) {
      const content = attr(tag, 'content')
      if (content) metas.push(`${key}: ${content}`)
    }
  }

  const jsonLdProducts: unknown[] = []
  for (const m of src.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1])
      const items = Array.isArray(parsed) ? parsed : parsed?.['@graph'] ? parsed['@graph'] : [parsed]
      for (const it of items) {
        const t = it?.['@type']
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) jsonLdProducts.push(it)
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  const links: string[] = []
  let base: URL | null = null
  try {
    base = new URL(baseUrl)
  } catch {
    base = null
  }
  for (const m of src.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href')
    if (!href || !base || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue
    try {
      const u = new URL(href, base)
      u.hash = ''
      if ((u.protocol === 'https:' || u.protocol === 'http:') && sameSite(u.hostname, base.hostname)) links.push(u.toString())
    } catch {
      /* ignore bad links */
    }
  }

  let body = src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol|header|footer|main)>/gi, '\n')
    .replace(/<h([1-6])\b[^>]*>/gi, '\n## ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
  body = decodeEntities(body)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()

  const text = [title ? `# ${title}` : '', ...metas, body].filter(Boolean).join('\n').slice(0, MAX_CHARS)
  return { title, text, links: [...new Set(links)].slice(0, 500), jsonLdProducts: jsonLdProducts.slice(0, 50) }
}

/** Same site: exact host or the www / bare pair. */
export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '')
  return strip(a) === strip(b)
}
