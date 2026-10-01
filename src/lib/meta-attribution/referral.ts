/**
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

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  // Strip control characters; keep normal text and emoji.
  // eslint-disable-next-line no-control-regex
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

function cleanUrl(value: unknown): string | null {
  const text = clean(value, LIMITS.sourceUrl)
  if (!text) return null
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
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
