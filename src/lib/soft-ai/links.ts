/**
 * Links and bare domains in text (SecureDog INT-109 / INT-112, 2026-10-15). Pure, client-safe.
 * Used by "Corregir" (customer questions lose every link; owner text may only link allowed sites) and by the live reply
 * checker (output-validator 'foreign_link': a model reply may only link what the business itself configured or wrote).
 *
 * What counts as a link (round 3 — no false positives in normal chat):
 *  - scheme or "www." forms; a bare IPv4 (optional port / path);
 *  - label.tld WITH a path / query ("x.pw/a", "sinpe-pagos.icu/x", "instagram.com/tienda");
 *  - label.tld where the TLD is a real, non-word TLD, any case ("tienda.vip", "PAGOS-SINPE.COM", "sleep.shopping");
 *  - spelled-out forms ("bit . ly", "bit(.)ly", "bit[.]ly", "tienda punto com").
 * Not links: "Listo. me avisás", "listo.te", "Gracias.de nada", "Gracias.Info", "aprox.cada", "info. top", "Node.js".
 * Known gap (accepted): a word-like TLD with no path ("evil.example", "x.info") is not detected.
 */
import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'

const STOP = '[^\\s<>"\'«»]'
const LABEL = '[\\p{L}\\p{N}][\\p{L}\\p{N}-]{0,62}'
/** Spanish abbreviations that look like "x.yy". */
const NOT_TLD = '(?!(?:ej|etc|aprox|pag|tel|cel|ud|uds|sr|sra|srta|dr|dra|lic|ing|av|nro|num|art|cap|vol|max|min)(?![a-z]))'
/** Real TLDs that are not Spanish / English words: a link even without a path, any case. */
const REAL_TLDS = [
  'com', 'net', 'org', 'cr', 'shopping', 'store', 'shop', 'io', 'co', 'app', 'link', 'ly', 'gl', 'ee', 'icu', 'xyz', 'vip',
  'lol', 'pw', 'online', 'site', 'tk', 'club', 'biz', 'dev', 'tienda', 'ws', 'cc', 'ru', 'cn', 'ml', 'ga', 'cf', 'gq',
  'click', 'website', 'tech', 'digital', 'lat', 'bio', 'lnk',
]
/** Spelled "x . com" / "x. com" forms: only TLDs that are never a word after a sentence end ("Listo. me", "info. top"). */
const SPACED_TLDS = 'com|net|org|cr|ly|shop|store|shopping|xyz|icu|vip|lol|pw|link|io|app|online|site'
const SPELLED_TLDS = 'com|net|org|cr|ly|co|io|me|app|link|xyz|info|biz|site|store|shop|shopping|gl|to|ws|online|tk|club|top|page|dev|icu|vip|lol|pw'
const ci = (s: string) => s.split('').map((c) => `[${c}${c.toUpperCase()}]`).join('')
const REAL_TLD_CI = `(?:${REAL_TLDS.sort((a, b) => b.length - a.length).map(ci).join('|')})`
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
/**
 * Word-like TLDs (round 4, INT-109): a link without a path only when the label looks like a payment / shop name or has a
 * hyphen ("pagos.info", "sinpe.me", "pagos.live", "mi-tienda.top") — "Listo. me", "info. top" stay plain words.
 */
const WORD_TLDS = ['info', 'top', 'live', 'me', 'example', 'page', 'fun', 'pro', 'one', 'world', 'tv', 'to', 'es', 'site', 'online', 'store', 'app', 'link']
const WORD_TLD_CI = `(?:${WORD_TLDS.sort((a, b) => b.length - a.length).map(ci).join('|')})`
const PAYISH = `(?:${['pago', 'sinpe', 'pay', 'banco', 'bank', 'tienda', 'shop', 'promo', 'cobro', 'factura'].map(ci).join('|')})`
const PAYISH_LABEL = `[\\p{L}\\p{N}]*(?:-[\\p{L}\\p{N}-]*|${PAYISH}[\\p{L}\\p{N}-]*)`

const LINK_SOURCE = [
  // Scheme or www.
  `(?:[Hh][Tt][Tt][Pp][Ss]?|[Ff][Tt][Pp]):\\/\\/${STOP}+`,
  `(?<![\\p{L}\\p{N}@._-])[Ww]{3}\\.${STOP}+`,
  // Bare IPv4, optional port and path.
  `(?<![\\d.₡¢$])(?:${OCTET}\\.){3}${OCTET}(?![\\d.])(?::\\d{1,5})?(?:\\/${STOP}*)?`,
  // label(.label)*.tld followed by a path / query: any TLD.
  `(?<![\\p{L}\\p{N}@._-])(?:${LABEL}\\.)+${NOT_TLD}[A-Za-z]{2,24}[/?#\\\\]${STOP}*`,
  // label(.label)*.tld with a real TLD (any case), optional path.
  `(?<![\\p{L}\\p{N}@._-])(?:${LABEL}\\.)+${REAL_TLD_CI}(?![\\p{L}\\p{N}_-])(?:[/?#:\\\\]${STOP}*)?`,
  // Payment / shop-like or hyphenated label with a word-like TLD, no path needed.
  `(?<![\\p{L}\\p{N}@._-])(?:${LABEL}\\.)*${PAYISH_LABEL}\\.${WORD_TLD_CI}(?![\\p{L}\\p{N}_-])(?:[/?#:\\\\]${STOP}*)?`,
  // Spelled: "bit(.)ly", "bit [.] ly", "bit . ly", "tienda punto com".
  `(?<![\\p{L}\\p{N}@._-])${LABEL}(?:\\s*(?:\\(\\s*\\.\\s*\\)|\\[\\s*\\.\\s*\\]|\\{\\s*\\.\\s*\\})\\s*[a-z]{2,24}|\\s+\\.\\s*(?:${SPACED_TLDS})|\\s*\\.\\s+(?:${SPACED_TLDS})|\\s+(?:[Pp]unto|[Dd]ot)\\s+(?:${SPELLED_TLDS}))(?![\\p{L}\\p{N}_-])(?:\\/${STOP}*)?`,
].join('|')

/** A fresh global regex (callers may use replace / matchAll safely). */
export function linkRegex(): RegExp {
  return new RegExp(LINK_SOURCE, 'gu')
}

/** Links / domains in a text, trailing punctuation trimmed. */
export function linksIn(text: string): string[] {
  return [...stripFormatChars(text).matchAll(linkRegex())].map((m) => m[0].replace(/[.,;:!?)\]]+$/, ''))
}

/** URL shorteners: their codes are case-sensitive ("bit.ly/PROMO1" is not "bit.ly/Promo1"). */
const SHORTENER_HOSTS = ['bit.ly', 'goo.gl', 'tinyurl.com', 't.co', 'cutt.ly', 'is.gd', 'ow.ly', 'rebrand.ly', 'shorturl.at']

function isShortener(host: string): boolean {
  return SHORTENER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

export type ParsedLink = {
  /** Lowercased, no "www.", port or trailing dot. */
  host: string
  /** Normalized path without leading / trailing "/": lowercased except on shorteners. */
  path: string
  /** "user@host" — never allowed (INT-112). */
  userinfo: boolean
  /** Empty host or a host with "@", "\", "%" or spaces — never allowed. */
  bad: boolean
}

/**
 * WHATWG-like normalization before any allowlist compare (round 4, INT-112): spelled dots joined, "\" read as "/",
 * scheme and userinfo removed, %2e / %2f / %5c decoded in the path, "." and ".." segments resolved, query / fragment
 * dropped. "instagram.com/mitienda/../otra", "%2e%2e", "google.com/maps/../../url?q=", "evil.com\.mitienda.cr/pago"
 * all normalize to what a browser would open.
 */
export function parseLink(link: string): ParsedLink {
  let s = (link || '')
    .trim()
    .replace(/\s*(?:\(\s*\.\s*\)|\[\s*\.\s*\]|\{\s*\.\s*\})\s*/g, '.')
    .replace(/\s+(?:punto|dot)\s+/gi, '.')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\\/g, '/')
  s = s.replace(/^(?:https?|ftp):\/*/i, '').replace(/^\/+/, '')
  const cut = s.search(/[/?#]/)
  let authority = cut < 0 ? s : s.slice(0, cut)
  const rest = cut < 0 ? '' : s.slice(cut)
  const userinfo = authority.includes('@')
  if (userinfo) authority = authority.slice(authority.lastIndexOf('@') + 1)
  const host = authority.toLowerCase().replace(/:\d*$/, '').replace(/\.+$/, '').replace(/^www\./, '')
  const bad = !host || /[@\\%\s]/.test(host)
  const rawPath = rest.split(/[?#]/)[0].replace(/%2e/gi, '.').replace(/%2f/gi, '/').replace(/%5c/gi, '/')
  const segments: string[] = []
  for (const seg of rawPath.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      segments.pop()
      continue
    }
    segments.push(seg)
  }
  const joined = segments.join('/')
  return { host, path: isShortener(host) ? joined : joined.toLowerCase(), userinfo, bad }
}

/** Normalized "host/path" of a link (parseLink). */
export function linkHostPath(link: string): string {
  const p = parseLink(link)
  return p.path ? `${p.host}/${p.path}` : p.host
}

/** Host of a link, lowercased, without scheme / "www." / obfuscation ("bit (.) ly" → "bit.ly"). */
export function linkHost(link: string): string {
  return parseLink(link).host
}

/** The brand's own domains (website / catalog from brand facts). */
export function brandDomainsFrom(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.map((u) => linkHost(u || '')).filter((h) => h.includes('.')))]
}

/**
 * Hosts many businesses share: only the exact path prefix the business configured or wrote is allowed, never the
 * whole host ("instagram.com/mitienda" allows "instagram.com/mitienda/p/1", not "instagram.com/otra").
 */
export const SHARED_LINK_HOSTS = [
  'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'm.me', 'wa.me', 'whatsapp.com', 'linktr.ee', 'bit.ly', 'goo.gl',
  'google.com', 'forms.gle', 'tiktok.com', 'youtube.com', 'youtu.be', 't.me', 'x.com', 'twitter.com', 'waze.com',
  'tinyurl.com', 'cutt.ly', 't.co', 'is.gd', 'ow.ly', 'rebrand.ly', 'shorturl.at',
]

function isSharedHost(host: string): boolean {
  return SHARED_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

const GOOGLE_TLD = '(?:[a-z]{2,3}|co\\.[a-z]{2}|com\\.[a-z]{2})'
/** A maps URL contributes only when it is a map link on an exact maps host (anchored: no "google.com.evil.com/maps"). */
export function isMapLink(link: string): boolean {
  const p = parseLink(link)
  if (p.bad || p.userinfo) return false
  const first = p.path.split('/')[0]
  if (new RegExp(`^google\\.${GOOGLE_TLD}$`).test(p.host)) return first === 'maps'
  if (new RegExp(`^maps\\.google\\.${GOOGLE_TLD}$`).test(p.host)) return true
  if (p.host === 'maps.app.goo.gl') return p.path.length > 0
  if (p.host === 'goo.gl') return first === 'maps' && p.path.length > 'maps'.length
  if (p.host === 'waze.com') return first === 'ul' || first === 'live-map'
  return false
}

/** Hosts allowed whole (the brand's own, non-shared) + "host/path" prefixes (shared hosts, map links). */
export type LinkAllowlist = { hosts: string[]; prefixes: string[] }

/**
 * INT-112: what a model reply may link — the brand website / catalog (whole host when it is not a shared host), the
 * maps URL only when it is a map link, and links the owner wrote in ACTIVE saved replies and APPROVED bound knowledge.
 */
export function buildLinkAllowlist(input: {
  website?: string | null
  catalogUrl?: string | null
  mapsUrl?: string | null
  ownerTexts?: Array<string | null | undefined>
}): LinkAllowlist {
  const hosts = new Set<string>()
  const prefixes = new Set<string>()
  const add = (link: string) => {
    const p = parseLink(link)
    if (p.bad || p.userinfo || !p.host.includes('.')) return
    if (!isSharedHost(p.host)) hosts.add(p.host)
    else if (p.path) prefixes.add(`${p.host}/${p.path}`)
  }
  for (const url of [input.website, input.catalogUrl]) if (url) add(url)
  if (input.mapsUrl && isMapLink(input.mapsUrl)) prefixes.add(linkHostPath(input.mapsUrl))
  for (const text of input.ownerTexts ?? []) for (const link of linksIn(text || '')) add(link)
  return { hosts: [...hosts], prefixes: [...prefixes] }
}

/** Compared after parseLink normalization, prefixes on a path-segment boundary. */
export function isAllowedLink(link: string, allow: LinkAllowlist): boolean {
  const p = parseLink(link)
  if (p.bad || p.userinfo) return false
  if (!isSharedHost(p.host) && allow.hosts.some((d) => p.host === d || p.host.endsWith(`.${d}`))) return true
  const full = p.path ? `${p.host}/${p.path}` : p.host
  return allow.prefixes.some((pre) => full === pre || full.startsWith(`${pre}/`))
}

/** Links in a text that are not allowed. A plain domain list means those hosts (non-shared) are allowed whole. */
export function foreignLinks(text: string, allow: LinkAllowlist | readonly string[]): string[] {
  const list: LinkAllowlist = Array.isArray(allow) ? { hosts: [...allow], prefixes: [] } : (allow as LinkAllowlist)
  return linksIn(text).filter((l) => !isAllowedLink(l, list))
}
