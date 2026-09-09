import { SignJWT, jwtVerify } from 'jose'
import type { InstagramPageMatch } from '@/lib/instagram-connect'

const COOKIE_NAME = 'ig_connect_pending'
const TTL_SECONDS = 600

function getSecretKey() {
  const secret = (process.env.NEXTAUTH_SECRET || '').trim()
  if (!secret) throw new Error('NEXTAUTH_SECRET missing')
  return new TextEncoder().encode(secret)
}

export type InstagramPendingConnect = {
  tenantId: string
  userId: string
  matches: InstagramPageMatch[]
}

export function getInstagramPendingCookieName() {
  return COOKIE_NAME
}

export async function signInstagramPendingConnect(payload: InstagramPendingConnect): Promise<string> {
  return new SignJWT({
    tenantId: payload.tenantId,
    userId: payload.userId,
    matches: payload.matches,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecretKey())
}

export async function verifyInstagramPendingConnect(token: string): Promise<InstagramPendingConnect | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
    const userId = typeof payload.userId === 'string' ? payload.userId : null
    const matches = Array.isArray(payload.matches) ? (payload.matches as InstagramPageMatch[]) : []
    if (!tenantId || !userId || matches.length === 0) return null
    return { tenantId, userId, matches }
  } catch {
    return null
  }
}

export const INSTAGRAM_PENDING_COOKIE_MAX_AGE = TTL_SECONDS
