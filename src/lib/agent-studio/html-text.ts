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

const MAX_HTML = 1_000_000
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas'])
const BLOCK_END = new Set(['p', 'div', 'section', 'article', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'ul', 'ol', 'header', 'footer', 'main'])

/**
 * One linear pass (indexOf only — no backtracking regex over the page): hostile unclosed tags / comments cannot
 * make this slower than O(n). An unclosed comment or skipped block drops the rest of the page.
 */
export function htmlToText(html: string, baseUrl: string): HtmlExtract {
  const src = html.slice(0, MAX_HTML)
  const lower = src.toLowerCase()
  let base: URL | null = null
  try {
    base = new URL(baseUrl)
  } catch {
    base = null
  }
  let title = ''
  const metas: string[] = []
  const jsonLdProducts: unknown[] = []
  const links: string[] = []
  const out: string[] = []

  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      out.push(src.slice(i))
      break
    }
    out.push(src.slice(i, lt))
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4)
      if (end < 0) break
      out.push(' ')
      i = end + 3
      continue
    }
    const gt = src.indexOf('>', lt + 1)
    if (gt < 0) break
    const tag = src.slice(lt + 1, gt)
    const nameMatch = /^\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)
    i = gt + 1
    if (!nameMatch) {
      out.push(' ')
      continue
    }
    const name = nameMatch[1].toLowerCase()
    const closing = tag[0] === '/'

    if (!closing && (SKIP_TAGS.has(name) || name === 'title')) {
      const end = lower.indexOf(`</${name}`, i)
      const inner = end < 0 ? '' : src.slice(i, end)
      if (name === 'title' && !title) title = decodeEntities(inner.replace(/\s+/g, ' ').trim()).slice(0, 200)
      if (name === 'script' && /application\/ld\+json/i.test(tag) && inner.length <= 500_000) collectJsonLd(inner, jsonLdProducts)
      if (end < 0) break
      const close = src.indexOf('>', end)
      if (close < 0) break
      i = close + 1
      out.push(' ')
      continue
    }
    if (closing) {
      out.push(BLOCK_END.has(name) ? '\n' : ' ')
      continue
    }
    // Attribute regexes only on normal-size tags (a 1 MB tag with unclosed quotes would backtrack).
    if (tag.length > 4000) {
      out.push(' ')
      continue
    }
    if (name === 'meta') {
      const key = (attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase()
      if (/^(description|og:title|og:description|product:price:amount|product:price:currency|og:site_name)$/.test(key)) {
        const content = attr(tag, 'content')
        if (content) metas.push(`${key}: ${content.slice(0, 500)}`)
      }
    } else if (name === 'a' && base && links.length < 2000) {
      const href = attr(tag, 'href')
      if (href && !/^(mailto:|tel:|javascript:|#)/i.test(href)) {
        try {
          const u = new URL(href, base)
          u.hash = ''
          if ((u.protocol === 'https:' || u.protocol === 'http:') && sameSite(u.hostname, base.hostname)) links.push(u.toString())
        } catch {
          /* ignore bad links */
        }
      }
    }
    out.push(name === 'br' || name === 'hr' ? '\n' : /^h[1-6]$/.test(name) ? '\n## ' : name === 'li' ? '\n- ' : ' ')
  }

  const body = decodeEntities(out.join(''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
  const text = [title ? `# ${title}` : '', ...metas, body].filter(Boolean).join('\n').slice(0, MAX_CHARS)
  return { title, text, links: [...new Set(links)].slice(0, 500), jsonLdProducts: jsonLdProducts.slice(0, 50) }
}

function collectJsonLd(raw: string, into: unknown[]) {
  try {
    const parsed = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : parsed?.['@graph'] ? parsed['@graph'] : [parsed]
    for (const it of items) {
      const t = it?.['@type']
      if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) into.push(it)
    }
  } catch {
    /* ignore malformed JSON-LD */
  }
}

/** Same site: exact host or the www / bare pair. */
export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '')
  return strip(a) === strip(b)
}
