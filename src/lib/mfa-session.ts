/**
 * Two-step login: the session between "password (or Google) OK" and "code OK".
 *
 * While the second step is pending, the JWT carries NO user: no sub / id / email / business /
 * role. The real claims are held inside the (encrypted, httpOnly) JWT under `mfaHeld` and restored
 * only when a verified challenge is consumed. So every reader of the session (middleware,
 * getServerSession, getToken, route helpers) sees "not signed in" until the code is proven; no
 * route has to remember a special check.
 *
 * Edge-safe (used by middleware): no Node or DB imports here.
 */
import { safeReturnPath } from './safe-return-path'

export const MFA_PENDING = 'pending' as const

type TokenLike = Record<string, unknown>

/** NextAuth sets these itself on every encode. */
const TRANSIENT_CLAIMS = new Set(['iat', 'exp', 'jti', 'mfa', 'mfaNonce', 'mfaUntil', 'mfaHeld'])

export function isMfaPendingToken(token: unknown): boolean {
  return Boolean(token && typeof token === 'object' && (token as TokenLike).mfa === MFA_PENDING)
}

export function holdTokenForMfa(token: TokenLike, nonce: string, expiresAt: number): TokenLike {
  const held: TokenLike = {}
  for (const [k, v] of Object.entries(token)) if (!TRANSIENT_CLAIMS.has(k)) held[k] = v
  return { mfa: MFA_PENDING, mfaNonce: nonce, mfaUntil: expiresAt, mfaHeld: held }
}

/** A dead session: middleware and helpers reject it (same shape as a revoked session). */
export function revokedMfaToken(reason: 'session_revoked' | 'mfa_unavailable' = 'session_revoked'): TokenLike {
  return { error: reason, active: false }
}

/** Held user id of a pending token (the verify route needs it; nothing else may use it). */
export function pendingMfaUserId(token: unknown): string | null {
  if (!isMfaPendingToken(token)) return null
  const held = (token as TokenLike).mfaHeld as TokenLike | undefined
  const id = held?.id ?? held?.sub
  return typeof id === 'string' && id ? id : null
}

export function pendingMfaNonce(token: unknown): string | null {
  if (!isMfaPendingToken(token)) return null
  const nonce = (token as TokenLike).mfaNonce
  return typeof nonce === 'string' && nonce ? nonce : null
}

export type PendingMfaResolution =
  | { kind: 'stay' }
  | { kind: 'revoked'; token: TokenLike }
  | { kind: 'upgraded'; token: TokenLike }

/**
 * Called by the jwt callback for a pending token. Expired → dead session. An explicit `update()`
 * with a verified, unconsumed challenge → the held claims come back (with a forced DB re-sync).
 * Anything else keeps it pending. The client payload is never read.
 */
export async function resolvePendingMfa(
  token: TokenLike,
  trigger: string | undefined,
  deps: { consume: (userId: string, nonce: string) => Promise<boolean>; now?: number },
): Promise<PendingMfaResolution> {
  const now = deps.now ?? Date.now()
  const until = Number(token.mfaUntil)
  const userId = pendingMfaUserId(token)
  const nonce = typeof token.mfaNonce === 'string' ? token.mfaNonce : ''
  if (!userId || !nonce || !Number.isFinite(until) || now >= until) {
    return { kind: 'revoked', token: revokedMfaToken() }
  }
  if (trigger !== 'update') return { kind: 'stay' }
  let consumed = false
  try {
    consumed = await deps.consume(userId, nonce)
  } catch {
    consumed = false // DB hiccup: stay pending, the user can retry
  }
  if (!consumed) return { kind: 'stay' }
  const held = { ...(token.mfaHeld as TokenLike) }
  return { kind: 'upgraded', token: { ...held, lastDbSync: 0 } }
}

/** Only these routes answer a pending session; everything else is 401 / redirect to the code page. */
const NEXTAUTH_CORE = ['/api/auth/session', '/api/auth/csrf', '/api/auth/signout', '/api/auth/providers', '/api/auth/_log', '/api/auth/error']
const NEXTAUTH_CORE_PREFIX = ['/api/auth/callback/', '/api/auth/signin/']

export const MFA_PAGE = '/auth/2fa'

export function isAllowedDuringMfa(pathname: string): boolean {
  if (pathname === MFA_PAGE) return true
  if (pathname === '/api/auth/2fa' || pathname.startsWith('/api/auth/2fa/')) return true
  if (pathname === '/api/auth/signin' || NEXTAUTH_CORE.includes(pathname)) return true
  return NEXTAUTH_CORE_PREFIX.some((p) => pathname.startsWith(p))
}

/** Public routes that read the session themselves: a pending session must not reach them. */
export function isSessionReadingPublicRoute(pathname: string): boolean {
  return (
    pathname === '/api/auth' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/invites/accept' ||
    pathname.startsWith('/api/invites/accept/')
  )
}

/**
 * Where to go after the code: the app's shared open-redirect guard (control characters, encoded
 * tricks, other origins, /auth /api /_next all refused; AUTH-47).
 */
export function safeMfaCallback(path: string | null | undefined, origin?: string): string {
  return safeReturnPath(path, { origin, fallback: '/dashboard' })
}
