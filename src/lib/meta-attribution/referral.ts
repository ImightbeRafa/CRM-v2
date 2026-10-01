/**
 * SecureDog INT- (2026-10-01): on WhatsApp the referral travels inside the end-to-end encrypted
 * message, so a modified client can forge every field. Treat it as unverified customer input:
 * links only to Meta hosts, text stripped of control / bidi characters, never trusted for AI.
 *
 * Ad referral data that Meta attaches to the first customer message after an ad click
 * (WhatsApp "click to WhatsApp" `messages[].referral`, Instagram `message.referral`).
 *
 * Pure parsing + sanitising only. `ctwaClid` is the WhatsApp click id Meta needs to attribute a
 * later sale; it is stored for the business's own dataset and must never be logged.
 */

export type AdReferralPlatform = 'whatsapp' | 'instagram'

export interface ParsedAdReferral {
  platform: AdReferralPlatform
  /** 'ad' | 'post' | … as Meta sends it (lower-cased). */
  sourceType: string | null
  /** Ad id (or post id) when Meta provides it. */
  sourceId: string | null
  /** Public link to the ad / post (https only). */
  sourceUrl: string | null
  headline: string | null
  body: string | null
  mediaType: string | null
  /** WhatsApp click id — the attribution key for Conversions API. */
  ctwaClid: string | null
  /** Instagram / Messenger `ref` parameter. */
  refParam: string | null
}

const LIMITS = {
  sourceType: 40,
  sourceId: 100,
  sourceUrl: 2048,
  headline: 300,
  body: 1000,
  mediaType: 40,
  ctwaClid: 512,
  refParam: 500,
} as const

// C0/C1 controls, zero-width and bidi override characters (spoofing in the side panel).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

/** Ad / post links are only ever on Meta's own domains. */
export const META_AD_HOSTS = ['facebook.com', 'fb.me', 'fb.com', 'instagram.com', 'whatsapp.com', 'wa.me'] as const

export function isMetaAdUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    const host = url.hostname.toLowerCase()
    return META_AD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > LIMITS.sourceUrl || !isMetaAdUrl(text)) return null
  const normalised = new URL(text).toString()
  // Length is checked again after normalising (percent-encoding can grow it past the DB limit).
  return normalised.length <= LIMITS.sourceUrl ? normalised : null
}

function cleanId(value: unknown, max: number): string | null {
  const text = clean(value, max)
  return text && /^[A-Za-z0-9_.:-]+$/.test(text) ? text : null
}

/** Normalises a raw referral object; null when nothing useful is left. */
export function sanitizeAdReferral(
  platform: AdReferralPlatform,
  raw: Record<string, unknown>,
): ParsedAdReferral | null {
  const out: ParsedAdReferral = {
    platform,
    sourceType: clean(raw.sourceType, LIMITS.sourceType)?.toLowerCase() ?? null,
    sourceId: cleanId(raw.sourceId, LIMITS.sourceId),
    sourceUrl: cleanUrl(raw.sourceUrl),
    headline: clean(raw.headline, LIMITS.headline),
    body: clean(raw.body, LIMITS.body),
    mediaType: clean(raw.mediaType, LIMITS.mediaType)?.toLowerCase() ?? null,
    ctwaClid: cleanId(raw.ctwaClid, LIMITS.ctwaClid),
    refParam: clean(raw.refParam, LIMITS.refParam),
  }
  const useful = out.sourceId || out.ctwaClid || out.sourceUrl || out.headline || out.refParam
  return useful ? out : null
}

/**
 * WhatsApp Cloud API `messages[].referral`:
 * { source_url, source_id, source_type, headline, body, media_type, image_url, video_url,
 *   thumbnail_url, ctwa_clid }. Media CDN URLs are signed and short-lived — never stored.
 */
export function parseWhatsAppReferral(message: unknown): ParsedAdReferral | null {
  const ref = (message as { referral?: unknown } | null)?.referral
  if (!ref || typeof ref !== 'object') return null
  const r = ref as Record<string, unknown>
  return sanitizeAdReferral('whatsapp', {
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceUrl: r.source_url,
    headline: r.headline,
    body: r.body,
    mediaType: r.media_type,
    ctwaClid: r.ctwa_clid,
  })
}

/**
 * Instagram messaging `message.referral`:
 * { ref, ad_id, source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title, photo_url, … } }.
 */
export function parseInstagramReferral(message: unknown): ParsedAdReferral | null {
  const ref = (message as { referral?: unknown } | null)?.referral
  if (!ref || typeof ref !== 'object') return null
  const r = ref as Record<string, unknown>
  const ads = (r.ads_context_data && typeof r.ads_context_data === 'object'
    ? r.ads_context_data
    : {}) as Record<string, unknown>
  const isAd = typeof r.source === 'string' && r.source.toUpperCase() === 'ADS'
  return sanitizeAdReferral('instagram', {
    sourceType: isAd ? 'ad' : r.source,
    sourceId: r.ad_id,
    headline: ads.ad_title,
    refParam: r.ref,
  })
}
