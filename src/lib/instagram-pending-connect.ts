import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { Redis } from '@upstash/redis'
import type { InstagramPageMatch } from '@/lib/instagram-connect'

const COOKIE_NAME = 'ig_connect_pending'
const TTL_SECONDS = 600
const STORE_PREFIX = 'ig_pending:'

export type InstagramPendingPublicMeta = {
  pageId: string
  pageName: string
  igBusinessAccountId: string
  igUsername?: string | null
}

export type InstagramPendingRecord = {
  tenantId: string
  userId: string
  matches: InstagramPageMatch[]
  createdAt: number
}

/** Cookie JWT payload — never includes page access tokens. */
export type InstagramPendingCookiePayload = {
  pendingId: string
  tenantId: string
  userId: string
  pageIds: string[]
}

type MemoryEntry = { expiresAt: number; ciphertext: string }

const memoryStore = new Map<string, MemoryEntry>()

let redisClient: Redis | null | undefined

function getSecretKey() {
  const secret = (process.env.NEXTAUTH_SECRET || '').trim()
  if (!secret) throw new Error('NEXTAUTH_SECRET missing')
  return new TextEncoder().encode(secret)
}

function deriveAesKey(): Buffer {
  const secret = (process.env.NEXTAUTH_SECRET || '').trim()
  if (!secret) throw new Error('NEXTAUTH_SECRET missing')
  return createHash('sha256').update(`ig-pending:${secret}`).digest()
}

/** Encrypt pending match payloads at rest (Redis / memory). */
export function encryptPendingRecord(record: InstagramPendingRecord): string {
  const key = deriveAesKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(record), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptPendingRecord(ciphertext: string): InstagramPendingRecord | null {
  try {
    const key = deriveAesKey()
    const raw = Buffer.from(ciphertext, 'base64url')
    if (raw.length < 28) return null
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const encrypted = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext) as InstagramPendingRecord
    if (!parsed?.tenantId || !parsed?.userId || !Array.isArray(parsed.matches)) return null
    return parsed
  } catch {
    return null
  }
}

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim()
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
  if (!url || !token) {
    redisClient = null
    return null
  }
  try {
    redisClient = new Redis({ url, token })
    return redisClient
  } catch {
    redisClient = null
    return null
  }
}

function pruneMemoryStore(now = Date.now()) {
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key)
  }
}

async function writeStore(pendingId: string, ciphertext: string): Promise<void> {
  const redis = getRedis()
  const key = `${STORE_PREFIX}${pendingId}`
  if (redis) {
    try {
      await redis.set(key, ciphertext, { ex: TTL_SECONDS })
      return
    } catch (error) {
      console.warn('[ig-pending] Redis write failed, using memory fallback', error)
    }
  }
  pruneMemoryStore()
  memoryStore.set(key, { ciphertext, expiresAt: Date.now() + TTL_SECONDS * 1000 })
}

async function readStore(pendingId: string): Promise<string | null> {
  const redis = getRedis()
  const key = `${STORE_PREFIX}${pendingId}`
  if (redis) {
    try {
      const value = await redis.get<string>(key)
      if (typeof value === 'string' && value.length > 0) return value
    } catch (error) {
      console.warn('[ig-pending] Redis read failed, trying memory fallback', error)
    }
  }
  pruneMemoryStore()
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return entry.ciphertext
}

async function deleteStore(pendingId: string): Promise<void> {
  const redis = getRedis()
  const key = `${STORE_PREFIX}${pendingId}`
  memoryStore.delete(key)
  if (redis) {
    try {
      await redis.del(key)
    } catch {
      // ignore
    }
  }
}

export function getInstagramPendingCookieName() {
  return COOKIE_NAME
}

export const INSTAGRAM_PENDING_COOKIE_MAX_AGE = TTL_SECONDS

/** Create server-side pending record; return cookie JWT without tokens. */
export async function createInstagramPendingConnect(params: {
  tenantId: string
  userId: string
  matches: InstagramPageMatch[]
}): Promise<{ cookieToken: string; pendingId: string; publicMatches: InstagramPendingPublicMeta[] }> {
  const pendingId = randomBytes(24).toString('hex')
  const record: InstagramPendingRecord = {
    tenantId: params.tenantId,
    userId: params.userId,
    matches: params.matches,
    createdAt: Date.now(),
  }
  await writeStore(pendingId, encryptPendingRecord(record))

  const pageIds = params.matches.map((match) => match.pageId)
  const cookieToken = await new SignJWT({
    pendingId,
    tenantId: params.tenantId,
    userId: params.userId,
    pageIds,
  } satisfies InstagramPendingCookiePayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecretKey())

  const publicMatches: InstagramPendingPublicMeta[] = params.matches.map((match) => ({
    pageId: match.pageId,
    pageName: match.pageName,
    igBusinessAccountId: match.igBusinessAccountId,
    igUsername: match.igUsername ?? null,
  }))

  return { cookieToken, pendingId, publicMatches }
}

export async function readInstagramPendingCookie(
  cookieValue: string,
): Promise<InstagramPendingCookiePayload | null> {
  try {
    const { payload } = await jwtVerify(cookieValue, getSecretKey())
    const pendingId = typeof payload.pendingId === 'string' ? payload.pendingId : null
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
    const userId = typeof payload.userId === 'string' ? payload.userId : null
    const pageIds = Array.isArray(payload.pageIds)
      ? payload.pageIds.filter((id): id is string => typeof id === 'string')
      : []
    if (!pendingId || !tenantId || !userId || pageIds.length === 0) return null
    // Hard guarantee for SD-01: reject if a legacy cookie somehow embeds tokens.
    const raw = JSON.stringify(payload)
    if (raw.includes('pageAccessToken') || raw.includes('accessToken')) return null
    return { pendingId, tenantId, userId, pageIds }
  } catch {
    return null
  }
}

export async function loadInstagramPendingRecord(
  cookieValue: string,
  session: { tenantId: string; userId: string },
): Promise<{ cookie: InstagramPendingCookiePayload; record: InstagramPendingRecord } | null> {
  const cookie = await readInstagramPendingCookie(cookieValue)
  if (!cookie) return null
  if (cookie.tenantId !== session.tenantId || cookie.userId !== session.userId) return null

  const ciphertext = await readStore(cookie.pendingId)
  if (!ciphertext) return null
  const record = decryptPendingRecord(ciphertext)
  if (!record) return null
  if (record.tenantId !== session.tenantId || record.userId !== session.userId) return null

  return { cookie, record }
}

export async function clearInstagramPending(pendingId: string): Promise<void> {
  await deleteStore(pendingId)
}

/** Test helper: inspect cookie JWT claims without verifying store. */
export async function decodeInstagramPendingCookieClaimsForTest(
  cookieToken: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(cookieToken, getSecretKey())
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}
