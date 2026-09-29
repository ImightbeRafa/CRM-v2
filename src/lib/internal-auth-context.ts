/**
 * Signed auth context between middleware and route handlers (security, 2026-09-28).
 *
 * Middleware validates the NextAuth JWT, then forwards `x-user-id` / `x-tenant-id` /
 * `x-user-role` / `x-user-email` so handlers can skip a second JWT decode. Those headers were
 * trusted as-is: any path the middleware did not run on (the image-extension matcher gap, e.g.
 * `/api/orders/x.png`) let a client send its own identity headers straight to a handler.
 *
 * Now the middleware also sends `x-betsy-ctx-sig` = HMAC-SHA256 over the four values, keyed from
 * NEXTAUTH_SECRET (no new secret). Handlers only trust the headers when the signature verifies;
 * otherwise they fall back to the full session check. Web Crypto only: runs on edge and Node.
 */

export const AUTH_CONTEXT_HEADERS = ['x-user-id', 'x-user-role', 'x-tenant-id', 'x-user-email', 'x-betsy-sv'] as const
export const AUTH_CONTEXT_SIG_HEADER = 'x-betsy-ctx-sig'
/** Every header a client must never be able to set (stripped by middleware and the CF worker). */
export const INTERNAL_AUTH_HEADERS = [...AUTH_CONTEXT_HEADERS, AUTH_CONTEXT_SIG_HEADER] as const

const KEY_LABEL = 'betsy-internal-auth-context-v1'

export type AuthContext = {
  userId: string
  tenantId: string | null
  role: string
  email: string | null
  /** Session version from the JWT (0 when absent); see src/lib/session-revocation.ts. */
  sv: number
}

const encoder = new TextEncoder()
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null

async function hmacKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  // Derived key: a signature here can never be replayed as any other NEXTAUTH_SECRET-keyed value.
  const derived = await crypto.subtle.sign('HMAC', base, encoder.encode(KEY_LABEL))
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function keyFor(secret: string): Promise<CryptoKey> {
  if (!cachedKey || cachedKey.secret !== secret) {
    const key = hmacKey(secret)
    key.catch(() => {
      if (cachedKey?.key === key) cachedKey = null
    })
    cachedKey = { secret, key }
  }
  return cachedKey.key
}

/** Unambiguous: every field is length-prefixed, so `a|b` + `c` never equals `a` + `b|c`. */
export function canonicalAuthContext(ctx: AuthContext): string {
  return [ctx.userId, ctx.tenantId ?? '', ctx.role, ctx.email ?? '', String(ctx.sv || 0)]
    .map((v) => `${v.length}:${v}`)
    .join('|')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function signAuthContext(ctx: AuthContext, secret = process.env.NEXTAUTH_SECRET): Promise<string | null> {
  if (!secret) return null
  const sig = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(canonicalAuthContext(ctx)))
  return toHex(sig)
}

/** Sets the four context headers plus their signature (middleware only). */
export async function setSignedAuthHeaders(headers: Headers, ctx: AuthContext, secret = process.env.NEXTAUTH_SECRET) {
  for (const name of INTERNAL_AUTH_HEADERS) headers.delete(name)
  const sig = await signAuthContext(ctx, secret)
  if (!sig) return // no secret: handlers fall back to the session check
  headers.set('x-user-id', ctx.userId)
  headers.set('x-user-role', ctx.role)
  if (ctx.tenantId) headers.set('x-tenant-id', ctx.tenantId)
  if (ctx.email) headers.set('x-user-email', ctx.email)
  headers.set('x-betsy-sv', String(ctx.sv || 0))
  headers.set(AUTH_CONTEXT_SIG_HEADER, sig)
}

/**
 * The middleware-set context, or null when the headers are absent or not signed by us.
 * Callers treat null as "no fast path" and do the full session check (never as a denial reason
 * on its own, so a key problem degrades to slower requests rather than an outage).
 */
export async function readVerifiedAuthContext(
  headers: Pick<Headers, 'get'>,
  secret = process.env.NEXTAUTH_SECRET,
): Promise<AuthContext | null> {
  const userId = headers.get('x-user-id')
  const role = headers.get('x-user-role')
  const sigHex = headers.get(AUTH_CONTEXT_SIG_HEADER)
  if (!userId || !role || !sigHex || !secret) return null
  const sig = fromHex(sigHex)
  if (!sig) return null
  const ctx: AuthContext = {
    userId,
    role,
    tenantId: headers.get('x-tenant-id') || null,
    email: headers.get('x-user-email') || null,
    sv: Number(headers.get('x-betsy-sv')) || 0,
  }
  try {
    // crypto.subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify('HMAC', await keyFor(secret), sig, encoder.encode(canonicalAuthContext(ctx)))
    return ok ? ctx : null
  } catch {
    return null
  }
}
