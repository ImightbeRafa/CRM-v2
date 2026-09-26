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

/** Exact refreshToken values that belong to a WABA (canonical + legacy numeric). */
export function whatsappRefreshTokensForWabaId(wabaId?: string | null): string[] {
  const id = (wabaId || '').trim()
  if (!id) return []
  const tokens = [`${WABA_PREFIX}${id}`]
  if (/^\d{5,}$/.test(id)) {
    tokens.push(id)
  }
  return tokens
}

/** Prisma where for PARTNER_REMOVED — exact `in`, never prefix `startsWith`. */
export function partnerRemovedWhatsAppWhere(wabaId?: string | null): {
  platform: 'whatsapp'
  isActive: true
  refreshToken: { in: string[] }
} | null {
  const tokens = whatsappRefreshTokensForWabaId(wabaId)
  if (!tokens.length) return null
  return {
    platform: 'whatsapp',
    isActive: true,
    refreshToken: { in: tokens },
  }
}

/** Prisma `where` for every tenant WhatsApp line on a WABA (wabaId column or refreshToken). */
export function whatsappAccountsForWabaWhere(
  tenantId: string,
  wabaId?: string | null,
): {
  tenantId: string
  platform: 'whatsapp'
  OR: Array<{ wabaId: string } | { refreshToken: { in: string[] } }>
} | null {
  const id = (wabaId || '').trim()
  const tokens = whatsappRefreshTokensForWabaId(id)
  if (!id || !tokens.length) return null
  return {
    tenantId,
    platform: 'whatsapp',
    OR: [{ wabaId: id }, { refreshToken: { in: tokens } }],
  }
}

export type ExistingWhatsAppPhoneResolution =
  | { ok: true; accountId: string; socialAccountId: string | null; source: 'claimed' | 'single_waba' }
  | { ok: false; reason: 'no_existing_account' | 'ambiguous_waba_accounts'; candidateCount: number }

/**
 * Reconnect helper: which phone_number_id to reuse when Graph phone listing is empty.
 * One WABA can host several lines (one SocialAccount each), so a WABA id alone must
 * never pick "the first" row — that would let line 2 overwrite line 1's account.
 * - explicit claimed phone_number_id always wins
 * - exactly one candidate line → reuse it
 * - zero → no_existing_account; more than one → ambiguous (caller must ask for a phone)
 */
export function resolveExistingWhatsAppPhoneForWaba(
  accounts: Array<{ id?: string | null; accountId?: string | null }>,
  claimedPhoneNumberId?: string | null,
): ExistingWhatsAppPhoneResolution {
  const claimed = (claimedPhoneNumberId || '').trim()
  if (claimed) {
    const match = accounts.find((row) => (row.accountId || '').trim() === claimed)
    return { ok: true, accountId: claimed, socialAccountId: match?.id ?? null, source: 'claimed' }
  }

  const lines = accounts.filter((row) => (row.accountId || '').trim())
  if (lines.length === 0) {
    return { ok: false, reason: 'no_existing_account', candidateCount: 0 }
  }
  if (lines.length > 1) {
    return { ok: false, reason: 'ambiguous_waba_accounts', candidateCount: lines.length }
  }
  const only = lines[0]!
  return {
    ok: true,
    accountId: String(only.accountId).trim(),
    socialAccountId: only.id ?? null,
    source: 'single_waba',
  }
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
