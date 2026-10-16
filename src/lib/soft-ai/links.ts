/**
 * Links and bare domains in text (SecureDog INT-109, 2026-10-15). Pure, client-safe.
 * Used by "Corregir" (customer questions lose every link; owner text may only link the brand's own site) and by the
 * live reply checker (output-validator 'foreign_link': a reply may only link the brand's own site).
 *
 * Generic on purpose: any label.label with a 2–24 letter lowercase TLD ("tienda.com", "bit.ly/x9", "x.shop"), plus
 * scheme / www forms and obfuscated ones ("bit . ly", "bit(.)ly", "bit[.]ly", "tienda punto com"). A capitalised word
 * after a dot ("Gracias.Info", "Listo.De nada") and Spanish abbreviations ("p.ej.") are not links.
 */
import { stripFormatChars } from '@/lib/soft-ai/prompt-fence'

const STOP = '[^\\s<>"\'«»]'
const LABEL = '[\\p{L}\\p{N}][\\p{L}\\p{N}-]{0,62}'
/** Spanish abbreviations that look like "x.yy". */
const NOT_TLD = '(?!(?:ej|etc|aprox|pag|tel|cel|ud|uds|sr|sra|srta|dr|dra|lic|ing|av|nro|num|art|cap|vol|max|min)(?![a-z]))'
const SHORT_TLDS = 'com|net|org|cr|ly|co|io|me|app|link|xyz|info|biz|site|store|shop|gl|to|ws|online|tk|club|top|page|dev'
const LINK_SOURCE = [
  // Scheme or www.
  `(?:[Hh][Tt][Tt][Pp][Ss]?|[Ff][Tt][Pp]):\\/\\/${STOP}+`,
  `(?<![\\p{L}\\p{N}@._-])[Ww]{3}\\.${STOP}+`,
  // Bare domain: label(.label)*.tld (lowercase TLD), optional path.
  `(?<![\\p{L}\\p{N}@._-])(?:${LABEL}\\.)+${NOT_TLD}[a-z]{2,24}(?![\\p{L}\\p{N}_-])(?:[/?#:]${STOP}*)?`,
  // Obfuscated: "bit(.)ly", "bit [.] ly", "bit . ly", "tienda punto com".
  `(?<![\\p{L}\\p{N}@._-])${LABEL}(?:\\s*(?:\\(\\s*\\.\\s*\\)|\\[\\s*\\.\\s*\\]|\\{\\s*\\.\\s*\\})\\s*[a-z]{2,24}|\\s+\\.\\s*(?:${SHORT_TLDS})|\\s*\\.\\s+(?:${SHORT_TLDS})|\\s+(?:[Pp]unto|[Dd]ot)\\s+(?:${SHORT_TLDS}))(?![\\p{L}\\p{N}_-])(?:\\/${STOP}*)?`,
].join('|')

/** A fresh global regex (callers may use replace / matchAll safely). */
export function linkRegex(): RegExp {
  return new RegExp(LINK_SOURCE, 'gu')
}

/** Links / domains in a text, trailing punctuation trimmed. */
export function linksIn(text: string): string[] {
  return [...stripFormatChars(text).matchAll(linkRegex())].map((m) => m[0].replace(/[.,;:!?)\]]+$/, ''))
}

/** Host of a link, lowercased, without scheme / "www." / obfuscation ("bit (.) ly" → "bit.ly"). */
export function linkHost(link: string): string {
  return (link || '')
    .toLowerCase()
    .replace(/\s*(?:\(\s*\.\s*\)|\[\s*\.\s*\]|\{\s*\.\s*\})\s*/g, '.')
    .replace(/\s+(?:punto|dot)\s+/g, '.')
    .replace(/\s*\.\s*/g, '.')
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:\s]/)[0]
}

/** The brand's own domains (website / catalog / maps from brand facts). */
export function brandDomainsFrom(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.map((u) => linkHost(u || '')).filter((h) => h.includes('.')))]
}

export function isBrandLink(link: string, brandDomains: readonly string[]): boolean {
  const host = linkHost(link)
  return brandDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Links in a text that are not on the brand's own domains (none configured → every link is foreign). */
export function foreignLinks(text: string, brandDomains: readonly string[]): string[] {
  return linksIn(text).filter((l) => !isBrandLink(l, brandDomains))
}
