/**
 * SocialAccount token lifecycle helpers (Respond.io Phase 5).
 * Pure classification + light Graph probes. Does not touch staff-bot paths.
 */

import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'

export const SOCIAL_TOKEN_STATUSES = [
  'valid',
  'expiring',
  'expired',
  'revoked',
  'error',
  'unknown',
] as const

export type SocialTokenStatus = (typeof SOCIAL_TOKEN_STATUSES)[number]

/** Warn when a known expiry is within this window. */
export const TOKEN_EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type TokenHealthAccount = {
  id: string
  platform: string
  accountId: string
  accessToken?: string | null
  expiresAt?: Date | string | null
  isActive?: boolean
  disconnectedAt?: Date | string | null
  tokenStatus?: string | null
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
}

export type TokenProbeResult = {
  tokenStatus: SocialTokenStatus
  lastErrorCode: string | null
  httpStatus?: number | null
}

/** Convert OAuth `expires_in` seconds into an absolute Date (null if missing/invalid). */
export function expiresAtFromExpiresIn(
  expiresIn: unknown,
  nowMs: number = Date.now(),
): Date | null {
  const seconds = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(nowMs + seconds * 1000)
}

/**
 * Meta `expires_at` is a unix timestamp; `0` means non-expiring.
 * Prefer the earliest non-zero of expires_at / data_access_expires_at when both exist.
 */
export function expiresAtFromMetaDebug(data: {
  expires_at?: unknown
  data_access_expires_at?: unknown
}): Date | null {
  const candidates: number[] = []
  for (const raw of [data.expires_at, data.data_access_expires_at]) {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n > 0) candidates.push(n)
  }
  if (candidates.length === 0) return null
  return new Date(Math.min(...candidates) * 1000)
}

export function classifyTokenStatus(params: {
  now?: Date
  expiresAt?: Date | string | null
  graphOk?: boolean | null
  graphErrorCode?: string | number | null
  graphHttpStatus?: number | null
}): SocialTokenStatus {
  const now = params.now ?? new Date()
  const code = params.graphErrorCode != null ? String(params.graphErrorCode) : null

  if (code === '190' || code === '102' || code === '463' || code === '467') {
    return 'revoked'
  }

  if (params.graphOk === false) {
    const status = params.graphHttpStatus ?? 0
    if (status === 401 || status === 403) return 'revoked'
    return 'error'
  }

  if (params.expiresAt) {
    const expires =
      params.expiresAt instanceof Date ? params.expiresAt : new Date(params.expiresAt)
    if (!Number.isNaN(expires.getTime())) {
      if (expires.getTime() <= now.getTime()) return 'expired'
      if (expires.getTime() - now.getTime() <= TOKEN_EXPIRING_WINDOW_MS) return 'expiring'
    }
  }

  if (params.graphOk === true) return 'valid'
  return 'unknown'
}

export function isMetaInvalidTokenError(error: unknown): boolean {
  const code = extractMetaErrorCode(error)
  return code === '190' || code === '102' || code === '463' || code === '467'
}

export function extractMetaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const nested = record.error
  if (nested && typeof nested === 'object') {
    const code = (nested as Record<string, unknown>).code
    if (code != null) return String(code)
  }
  if (record.code != null) return String(record.code)
  return null
}

/** Spanish copy for send/API when the channel cannot send. */
export function socialTokenSendBlockMessage(account: {
  platform: string
  tokenStatus?: string | null
  isActive?: boolean
  disconnectedAt?: Date | string | null
}): string {
  const platformLabel = account.platform === 'instagram' ? 'Instagram' : 'WhatsApp'
  const status = (account.tokenStatus || '').toLowerCase()

  if (account.disconnectedAt || account.isActive === false) {
    return `La cuenta de ${platformLabel} está desvinculada. Reconectala en Configuración → Cuentas sociales.`
  }
  if (status === 'revoked') {
    return `El token de ${platformLabel} fue revocado. Reconectá la cuenta en Configuración → Cuentas sociales.`
  }
  if (status === 'expired') {
    return `El token de ${platformLabel} expiró. Reconectá la cuenta en Configuración → Cuentas sociales.`
  }
  return `No se puede enviar por ${platformLabel}. Revisá la conexión en Configuración → Cuentas sociales.`
}

/** Banner label: "Reconectar Instagram · @shop" / "Reconectar WhatsApp · Forge". */
export function socialReconnectBannerLabel(account: TokenHealthAccount): string {
  const platformLabel = account.platform === 'instagram' ? 'Instagram' : 'WhatsApp'
  let name: string | null | undefined
  if (account.platform === 'instagram') {
    name = account.providerUsername
      ? `@${account.providerUsername.replace(/^@/, '')}`
      : account.displayName || account.providerDisplayName
  } else {
    name = account.displayName || account.providerDisplayName || account.displayPhoneNumber
  }
  return `Reconectar ${platformLabel} · ${name || account.accountId}`
}

export function accountNeedsReconnect(account: TokenHealthAccount): boolean {
  const status = (account.tokenStatus || '').toLowerCase()
  return status === 'revoked' || status === 'expired' || status === 'expiring'
}

export async function debugMetaTokenExpiry(params: {
  inputToken: string
  appAccessToken: string
}): Promise<Date | null> {
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(
      `debug_token?input_token=${encodeURIComponent(params.inputToken)}&access_token=${encodeURIComponent(params.appAccessToken)}`,
    ),
    params.appAccessToken,
  )
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' })
    if (!res.ok) return null
    const json = (await res.json()) as {
      data?: { expires_at?: number; data_access_expires_at?: number }
    }
    return expiresAtFromMetaDebug(json.data || {})
  } catch {
    return null
  }
}

export async function probeSocialAccountToken(
  account: TokenHealthAccount,
): Promise<TokenProbeResult> {
  const plain = decryptSocialAccessToken(account.accessToken)
  if (!plain) {
    return { tokenStatus: 'revoked', lastErrorCode: 'missing_token', httpStatus: null }
  }

  const path =
    account.platform === 'instagram'
      ? `${encodeURIComponent(account.accountId)}?fields=username`
      : `${encodeURIComponent(account.accountId)}?fields=id`

  const url = addAppSecretProofToUrl(buildMetaGraphUrl(path), plain)

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${plain}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    const json = await res.json().catch(() => ({}))
    const errorCode = extractMetaErrorCode(json)

    if (!res.ok) {
      return {
        tokenStatus: classifyTokenStatus({
          graphOk: false,
          graphErrorCode: errorCode,
          graphHttpStatus: res.status,
          expiresAt: account.expiresAt,
        }),
        lastErrorCode: errorCode || `http_${res.status}`,
        httpStatus: res.status,
      }
    }

    return {
      tokenStatus: classifyTokenStatus({
        graphOk: true,
        expiresAt: account.expiresAt,
      }),
      lastErrorCode: null,
      httpStatus: res.status,
    }
  } catch (error) {
    return {
      tokenStatus: 'error',
      lastErrorCode: error instanceof Error ? error.name || 'network_error' : 'network_error',
      httpStatus: null,
    }
  }
}

/** Soft-unlink update payload — never deletes the row. */
export function softUnlinkUpdateData(now: Date = new Date()) {
  return {
    isActive: false,
    disconnectedAt: now,
    accessToken: null,
    refreshToken: null,
    tokenStatus: 'unknown' as const,
    lastErrorAt: now,
    lastErrorCode: 'unlinked',
  }
}

/** Fields to clear when the same Meta asset is reconnected. */
export function reconnectLifecycleData(params: {
  isActive: boolean
  expiresAt?: Date | null
  now?: Date
}) {
  const now = params.now ?? new Date()
  return {
    disconnectedAt: null,
    lastErrorAt: params.isActive ? null : now,
    lastErrorCode: params.isActive ? null : 'subscribe_failed',
    tokenStatus: params.isActive ? ('valid' as const) : ('unknown' as const),
    tokenLastCheckedAt: now,
    subscribedAt: params.isActive ? now : undefined,
    expiresAt: params.expiresAt === undefined ? undefined : params.expiresAt,
    isActive: params.isActive,
  }
}
