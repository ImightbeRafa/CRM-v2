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

const LINK_SOURCE = [
  // Scheme or www.
  `(?:[Hh][Tt][Tt][Pp][Ss]?|[Ff][Tt][Pp]):\\/\\/${STOP}+`,
  `(?<![\\p{L}\\p{N}@._-])[Ww]{3}\\.${STOP}+`,
  // Bare IPv4, optional port and path.
  `(?<![\\d.₡¢$])(?:${OCTET}\\.){3}${OCTET}(?![\\d.])(?::\\d{1,5})?(?:\\/${STOP}*)?`,
  // label(.label)*.tld followed by a path / query: any TLD.
  `(?<![\\p{L}\\p{N}@._-])(?:${LABEL}\\.)+${NOT_TLD}[A-Za-z]{2,24}[/?#]${STOP}*`,
  // label(.label)*.tld with a real TLD (any case), optional path.
  `(?<![\\p{L}\\p{N}@._-])(?:${LABEL}\\.)+${REAL_TLD_CI}(?![\\p{L}\\p{N}_-])(?:[/?#:]${STOP}*)?`,
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

/** Lowercased "host/path" of a link: no scheme, "www.", obfuscation, query, fragment or trailing slash. */
export function linkHostPath(link: string): string {
  return (link || '')
    .toLowerCase()
    .replace(/\s*(?:\(\s*\.\s*\)|\[\s*\.\s*\]|\{\s*\.\s*\})\s*/g, '.')
    .replace(/\s+(?:punto|dot)\s+/g, '.')
    .replace(/\s*\.\s*/g, '.')
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[?#\s]/)[0]
    .replace(/:\d+(?=\/|$)/, '')
    .replace(/\/+$/, '')
}

/** Host of a link, lowercased, without scheme / "www." / obfuscation ("bit (.) ly" → "bit.ly"). */
export function linkHost(link: string): string {
  return linkHostPath(link).split('/')[0]
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
  'tinyurl.com', 'cutt.ly',
]

function isSharedHost(host: string): boolean {
  return SHARED_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/** Map links that a maps URL may contribute (anything else in mapsUrl is ignored). */
const MAP_PATH_RE = /^(?:(?:[a-z0-9-]+\.)?google\.[a-z.]+\/maps(?:\/|$)|maps\.google\.[a-z.]+(?:\/|$)|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|waze\.com\/(?:ul|live-map)(?:\/|$))/

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
    const full = linkHostPath(link)
    const host = full.split('/')[0]
    if (!host.includes('.')) return
    if (!isSharedHost(host)) hosts.add(host)
    else if (full.includes('/')) prefixes.add(full)
  }
  for (const url of [input.website, input.catalogUrl]) if (url) add(url)
  if (input.mapsUrl) {
    const full = linkHostPath(input.mapsUrl)
    if (MAP_PATH_RE.test(full.includes('/') ? full : `${full}/`)) prefixes.add(full)
  }
  for (const text of input.ownerTexts ?? []) for (const link of linksIn(text || '')) add(link)
  return { hosts: [...hosts], prefixes: [...prefixes] }
}

export function isAllowedLink(link: string, allow: LinkAllowlist): boolean {
  const full = linkHostPath(link)
  const host = full.split('/')[0]
  if (!isSharedHost(host) && allow.hosts.some((d) => host === d || host.endsWith(`.${d}`))) return true
  return allow.prefixes.some((p) => full === p || full.startsWith(`${p}/`))
}

/** Links in a text that are not allowed. A plain domain list means those hosts (non-shared) are allowed whole. */
export function foreignLinks(text: string, allow: LinkAllowlist | readonly string[]): string[] {
  const list: LinkAllowlist = Array.isArray(allow) ? { hosts: [...allow], prefixes: [] } : (allow as LinkAllowlist)
  return linksIn(text).filter((l) => !isAllowedLink(l, list))
}
