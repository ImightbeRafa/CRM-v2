/**
 * SocialAccount has no dedicated WABA / Page columns yet.
 * Store non-secret Meta asset ids in refreshToken without a schema migration.
 * Never store access tokens here.
 */

const PAGE_PREFIX = 'page:'
const WABA_PREFIX = 'waba:'

export function encodeWhatsAppRefreshToken(whatsappBusinessAccountId?: string | null): string | null {
  const waba = (whatsappBusinessAccountId || '').trim()
  if (!waba) return null
  return `${WABA_PREFIX}${waba}`
}

export function encodeInstagramRefreshToken(pageId?: string | null): string | null {
  const id = (pageId || '').trim()
  if (!id) return null
  return `${PAGE_PREFIX}${id}`
}

export function parseSocialRefreshToken(refreshToken?: string | null): {
  whatsappBusinessAccountId: string | null
  pageId: string | null
} {
  const value = (refreshToken || '').trim()
  if (!value) {
    return { whatsappBusinessAccountId: null, pageId: null }
  }
  if (value.startsWith(WABA_PREFIX)) {
    return { whatsappBusinessAccountId: value.slice(WABA_PREFIX.length) || null, pageId: null }
  }
  if (value.startsWith(PAGE_PREFIX)) {
    return { whatsappBusinessAccountId: null, pageId: value.slice(PAGE_PREFIX.length) || null }
  }
  // Legacy: raw WABA id stored without prefix
  if (/^\d{5,}$/.test(value)) {
    return { whatsappBusinessAccountId: value, pageId: null }
  }
  return { whatsappBusinessAccountId: null, pageId: null }
}

/** Match an account whose refreshToken encodes `page:<pageId>`. */
export function matchAccountByEncodedPageId<T extends { refreshToken?: string | null }>(
  accounts: T[],
  pageId: string,
): T | undefined {
  const target = pageId.trim()
  if (!target) return undefined
  return accounts.find((account) => parseSocialRefreshToken(account.refreshToken).pageId === target)
}

/** Page id carried on parsed Meta chat metadata for `object: page` webhooks. */
export function getPageIdFromMetaChatMetadata(metadata?: Record<string, unknown> | null): string | null {
  const pageId = metadata?.pageId
  if (typeof pageId !== 'string') return null
  const trimmed = pageId.trim()
  return trimmed || null
}
