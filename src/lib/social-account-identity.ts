/**
 * Channel display-name helpers (Respond.io PR-3 / §7).
 * Fallback chain must never render blank.
 */

export type ChannelLogoKey = 'whatsapp' | 'instagram'

export type SocialAccountIdentityFields = {
  id: string
  platform: string
  accountId: string
  isActive?: boolean
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
  phoneNumberId?: string | null
}

/** Allowed displayName charset after NFC + trim (§7.2). Includes @ / + for IG handles and WA phones. */
const DISPLAY_NAME_ALLOWED = /^[\p{L}\p{N} ._&’'@+\-]+$/u
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/u
const MAX_DISPLAY_NAME_CODEPOINTS = 40

export type DisplayNameValidation =
  | { ok: true; value: string | null; reset: boolean }
  | { ok: false; error: string }

export function countCodePoints(value: string): number {
  return Array.from(value).length
}

export function normalizeDisplayNameInput(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.normalize('NFC').trim()
}

/**
 * Validate PATCH displayName. Empty/whitespace → reset to provider default (caller applies).
 */
export function validateDisplayNameInput(raw: unknown): DisplayNameValidation {
  const value = normalizeDisplayNameInput(raw)
  if (!value) return { ok: true, value: null, reset: true }
  if (CONTROL_CHARS.test(value)) {
    return { ok: false, error: 'El nombre no puede incluir caracteres de control.' }
  }
  if (countCodePoints(value) > MAX_DISPLAY_NAME_CODEPOINTS) {
    return { ok: false, error: 'El nombre debe tener entre 1 y 40 caracteres.' }
  }
  if (!DISPLAY_NAME_ALLOWED.test(value)) {
    return {
      ok: false,
      error: 'El nombre solo admite letras, números, espacios, @, + y -_.&’',
    }
  }
  return { ok: true, value, reset: false }
}

/** IG handle with @; never treat a pure numeric id as a username. */
export function formatInstagramHandle(username: string | null | undefined): string | null {
  const raw = (username || '').trim().replace(/^@+/, '')
  if (!raw) return null
  if (/^\d+$/.test(raw)) return null
  return `@${raw}`
}

export function syntheticChannelFallback(account: SocialAccountIdentityFields): string {
  const platform = account.platform === 'instagram' ? 'instagram' : 'whatsapp'
  if (platform === 'whatsapp') {
    const id = (account.phoneNumberId || account.accountId || '').trim()
    if (!id) return 'WA · canal'
    if (id.length > 4) return `WA · …${id.slice(-4)}`
    return `WA · ${id}`
  }
  const id = (account.accountId || '').trim()
  if (!id) return 'IG · canal'
  if (id.length > 4) return `IG · …${id.slice(-4)}`
  return `IG · ${id}`
}

/**
 * Canonical fallback chain (§7.2):
 * displayName → providerDisplayName → displayPhoneNumber / @providerUsername → WA|IG · …last4
 */
export function resolveChannelDisplayName(account: SocialAccountIdentityFields): string {
  const custom = account.displayName?.trim()
  if (custom) return custom

  const platform = account.platform === 'instagram' ? 'instagram' : 'whatsapp'
  if (platform === 'whatsapp') {
    const verified = account.providerDisplayName?.trim()
    if (verified) return verified
    const phone = account.displayPhoneNumber?.trim()
    if (phone) return phone
    return syntheticChannelFallback(account)
  }

  const handle = formatInstagramHandle(account.providerUsername)
  if (handle) return handle
  const pageName = account.providerDisplayName?.trim()
  if (pageName) return pageName
  return syntheticChannelFallback(account)
}

/** Default displayName at connect (§7.2). */
export function defaultDisplayNameAtConnect(account: {
  platform: string
  providerDisplayName?: string | null
  displayPhoneNumber?: string | null
  providerUsername?: string | null
}): string | null {
  const platform = account.platform === 'instagram' ? 'instagram' : 'whatsapp'
  if (platform === 'whatsapp') {
    const verified = account.providerDisplayName?.trim()
    if (verified) return verified
    const phone = account.displayPhoneNumber?.trim()
    return phone || null
  }
  return formatInstagramHandle(account.providerUsername)
}

/** Secondary address for thread headers: phone or @handle. */
export function channelSecondaryAddress(account: SocialAccountIdentityFields): string | null {
  const platform = account.platform === 'instagram' ? 'instagram' : 'whatsapp'
  if (platform === 'whatsapp') {
    return account.displayPhoneNumber?.trim() || null
  }
  return formatInstagramHandle(account.providerUsername)
}

export function channelLogoKey(platform: string): ChannelLogoKey {
  return platform === 'instagram' ? 'instagram' : 'whatsapp'
}

export function platformFullName(platform: string): 'WhatsApp' | 'Instagram' | string {
  if (platform === 'whatsapp') return 'WhatsApp'
  if (platform === 'instagram') return 'Instagram'
  return platform
}

/** Soft AI / banners: "Canal: WhatsApp · Forge" */
export function formatCanalContextLine(account: SocialAccountIdentityFields): string {
  const name = resolveChannelDisplayName(account)
  return `Canal: ${platformFullName(account.platform)} · ${name}`
}

/** Thread meta: "WhatsApp · Forge · +506…" */
export function formatThreadChannelMeta(account: SocialAccountIdentityFields): string {
  const name = resolveChannelDisplayName(account)
  const secondary = channelSecondaryAddress(account)
  const parts = [platformFullName(account.platform), name]
  if (secondary && secondary !== name) parts.push(secondary)
  return parts.join(' · ')
}

export type ChatAccountDto = {
  id: string
  platform: string
  accountId: string
  linkedAt: Date | string
  isActive: boolean
  displayName: string
  providerDisplayName: string | null
  providerUsername: string | null
  displayPhoneNumber: string | null
  logoKey: ChannelLogoKey
  tokenStatus: string
  phoneNumberId: string | null
  whatsappBusinessAccountId: string | null
  pageId: string | null
  wabaId: string | null
  expiresAt: Date | string | null
  disconnectedAt: Date | string | null
}

export function toChatAccountDto(row: {
  id: string
  platform: string
  accountId: string
  linkedAt: Date | string
  isActive: boolean
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
  tokenStatus?: string | null
  wabaId?: string | null
  pageId?: string | null
  phoneNumberId?: string | null
  whatsappBusinessAccountId?: string | null
  expiresAt?: Date | string | null
  disconnectedAt?: Date | string | null
}): ChatAccountDto {
  const identity: SocialAccountIdentityFields = {
    id: row.id,
    platform: row.platform,
    accountId: row.accountId,
    isActive: row.isActive,
    displayName: row.displayName,
    providerDisplayName: row.providerDisplayName,
    providerUsername: row.providerUsername,
    displayPhoneNumber: row.displayPhoneNumber,
    phoneNumberId: row.phoneNumberId ?? (row.platform === 'whatsapp' ? row.accountId : null),
  }
  return {
    id: row.id,
    platform: row.platform,
    accountId: row.accountId,
    linkedAt: row.linkedAt,
    isActive: row.isActive,
    displayName: resolveChannelDisplayName(identity),
    providerDisplayName: row.providerDisplayName?.trim() || null,
    providerUsername: row.providerUsername?.trim() || null,
    displayPhoneNumber: row.displayPhoneNumber?.trim() || null,
    logoKey: channelLogoKey(row.platform),
    tokenStatus: row.tokenStatus?.trim() || 'unknown',
    phoneNumberId: row.platform === 'whatsapp' ? row.accountId : null,
    whatsappBusinessAccountId:
      row.platform === 'whatsapp' ? row.whatsappBusinessAccountId || row.wabaId || null : null,
    pageId: row.platform === 'instagram' ? row.pageId || null : null,
    wabaId: row.platform === 'whatsapp' ? row.wabaId || row.whatsappBusinessAccountId || null : null,
    expiresAt: row.expiresAt ?? null,
    disconnectedAt: row.disconnectedAt ?? null,
  }
}

/** True when platform-relevant identity fields are still NULL (needs Graph refresh). */
export function needsIdentityRefresh(row: {
  platform: string
  accessToken?: string | null
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
}): boolean {
  if (!row.accessToken) return false
  if (row.platform === 'whatsapp') {
    return !row.providerDisplayName?.trim() && !row.displayPhoneNumber?.trim()
  }
  if (row.platform === 'instagram') {
    return !row.providerUsername?.trim() && !row.providerDisplayName?.trim()
  }
  return false
}

export function identityPersistPayload(params: {
  platform: string
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
  wabaId?: string | null
  pageId?: string | null
  /** Existing custom alias — preserved on reconnect when set. */
  existingDisplayName?: string | null
}): {
  providerDisplayName: string | null
  providerUsername: string | null
  displayPhoneNumber: string | null
  wabaId: string | null
  pageId: string | null
  displayName: string | null
} {
  const providerDisplayName = params.providerDisplayName?.trim() || null
  const providerUsername = params.providerUsername?.trim()?.replace(/^@+/, '') || null
  const displayPhoneNumber = params.displayPhoneNumber?.trim() || null
  const existing = params.existingDisplayName?.trim() || null
  const defaults = defaultDisplayNameAtConnect({
    platform: params.platform,
    providerDisplayName,
    displayPhoneNumber,
    providerUsername,
  })
  return {
    providerDisplayName,
    providerUsername,
    displayPhoneNumber,
    wabaId: params.wabaId?.trim() || null,
    pageId: params.pageId?.trim() || null,
    displayName: existing || defaults,
  }
}
