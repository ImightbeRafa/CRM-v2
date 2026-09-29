/**
 * Chat file storage on Supabase Storage (same project as the database), 2026-09-29.
 *
 * Replaces Vercel Blob for chat files: the media cache (`chat-media/<tenant>/<message>`), sent
 * files, "Recientes" and quick-reply files (`chat-quick-replies/<tenant>/<file>`). Paths are the
 * same strings already stored in `ChatMessage.mediaBlobPath` / `Tenant.settings`, so no schema
 * change. Database backups stay OFF Supabase on purpose (src/lib/backups/blob-store.ts).
 *
 * - One PRIVATE bucket; only the server (service role) reads / writes. No public URLs.
 * - Every call has a hard timeout (a storage hang never leaves the UI spinning).
 * - The bucket is created on first use if it does not exist.
 * - Reads fall back to the legacy Vercel Blob store for files cached before the switch.
 */
import 'server-only'
import { del as vercelDel, get as vercelGet } from '@vercel/blob'

export const CHAT_STORAGE_BUCKET = process.env.CHAT_STORAGE_BUCKET || 'betsy-chat'
const WRITE_TIMEOUT_MS = 20_000
const READ_TIMEOUT_MS = 20_000
const META_TIMEOUT_MS = 10_000
/** Chat folders only: nothing else may be written through this module. */
const ALLOWED_PATH = /^(chat-media|chat-quick-replies)\/[A-Za-z0-9._\/-]{1,300}$/

export class ChatStorageError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'not_found' | 'rejected' | 'timeout' | 'network' | 'failed',
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ChatStorageError'
  }
}

function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    throw new ChatStorageError('Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', 'not_configured')
  }
  // The service key only ever goes to our Supabase project over HTTPS.
  let host = ''
  try {
    const parsed = new URL(url)
    host = parsed.protocol === 'https:' ? parsed.hostname : ''
  } catch {
    host = ''
  }
  if (!host.endsWith('.supabase.co')) {
    throw new ChatStorageError('SUPABASE_URL must be https://<project>.supabase.co', 'not_configured')
  }
  return { url, key }
}

export function isChatStorageConfigured(): boolean {
  return Boolean((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function assertPath(pathname: string) {
  if (!ALLOWED_PATH.test(pathname) || pathname.includes('..') || pathname.includes('//')) {
    throw new ChatStorageError('Refusing a path outside the chat folders', 'rejected')
  }
}

/** `a/b c.jpg` → `a/b%20c.jpg` (each segment encoded, slashes kept). */
function encodePath(pathname: string): string {
  return pathname.split('/').map(encodeURIComponent).join('/')
}

async function call(path: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const { url, key } = config()
  const { timeoutMs, headers, ...rest } = init
  try {
    return await fetch(`${url}/storage/v1/${path}`, {
      ...rest,
      headers: { Authorization: `Bearer ${key}`, apikey: key, ...(headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      // Never follow a redirect: the apikey header would go with it.
      redirect: 'error',
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ChatStorageError(`Supabase Storage timed out after ${timeoutMs} ms`, 'timeout')
    }
    throw new ChatStorageError(`Supabase Storage unreachable: ${error instanceof Error ? error.message : String(error)}`, 'network')
  }
}

async function failure(res: Response, what: string): Promise<ChatStorageError> {
  const text = await res.text().catch(() => '')
  let message = text.slice(0, 200)
  try {
    const j = JSON.parse(text) as { message?: string; error?: string }
    message = j.message || j.error || message
  } catch {
    // not JSON
  }
  const notFound = res.status === 404 || /not.?found/i.test(message)
  const code = notFound ? 'not_found' : res.status === 401 || res.status === 403 ? 'rejected' : 'failed'
  return new ChatStorageError(`${what}: ${res.status} ${message}`, code, res.status)
}

let bucketReady: Promise<void> | null = null

/** Tests only: forget the cached bucket check. */
export function __resetChatStorageForTests() {
  bucketReady = null
}

/** Creates the private bucket once per process (idempotent: "already exists" is fine). */
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const res = await call('bucket', {
        method: 'POST',
        timeoutMs: META_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: CHAT_STORAGE_BUCKET,
          name: CHAT_STORAGE_BUCKET,
          public: false,
          file_size_limit: 26214400,
        }),
      })
      if (!res.ok) {
        const err = await failure(res, 'create bucket')
        if (!(/already exists|duplicate/i.test(err.message) || res.status === 409)) throw err
      }
      // Privacy is checked every time, not only on create (a bucket flipped to public is refused).
      const info = await call(`bucket/${CHAT_STORAGE_BUCKET}`, { method: 'GET', timeoutMs: META_TIMEOUT_MS })
      if (!info.ok) throw await failure(info, 'bucket info')
      const bucket = (await info.json()) as { public?: boolean }
      if (bucket.public !== false) {
        throw new ChatStorageError(`Bucket ${CHAT_STORAGE_BUCKET} is public: refusing to store chat files`, 'rejected')
      }
    })().catch((error) => {
      bucketReady = null
      throw error
    })
  }
  return bucketReady
}

async function withBucket<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    // First write / read on a fresh project: create the bucket and retry once.
    if (error instanceof ChatStorageError && /bucket not found/i.test(error.message)) {
      await ensureBucket()
      return fn()
    }
    throw error
  }
}

export async function chatStoragePut(pathname: string, bytes: Uint8Array, contentType: string, opts: { overwrite?: boolean } = {}) {
  assertPath(pathname)
  await ensureBucket()
  return withBucket(async () => {
    const res = await call(`object/${CHAT_STORAGE_BUCKET}/${encodePath(pathname)}`, {
      method: 'POST',
      timeoutMs: WRITE_TIMEOUT_MS,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': opts.overwrite ? 'true' : 'false',
        // Message media never changes (1 h CDN cache); quick-reply files can be removed (60 s).
        'cache-control': pathname.startsWith('chat-quick-replies/') ? '60' : '3600',
      },
      body: bytes as unknown as BodyInit,
    })
    if (!res.ok) throw await failure(res, 'upload')
    return { pathname, size: bytes.length }
  })
}

export async function chatStorageGet(pathname: string): Promise<{ bytes: Buffer; contentType: string | null }> {
  assertPath(pathname)
  try {
    return await withBucket(async () => {
      const res = await call(`object/authenticated/${CHAT_STORAGE_BUCKET}/${encodePath(pathname)}`, {
        method: 'GET',
        timeoutMs: READ_TIMEOUT_MS,
      })
      if (!res.ok) throw await failure(res, 'download')
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') }
    })
  } catch (error) {
    // Files cached before the switch live in the old Vercel Blob store.
    if (error instanceof ChatStorageError && error.code === 'not_found' && process.env.BLOB_READ_WRITE_TOKEN) {
      const legacy = await legacyVercelGet(pathname)
      if (legacy) return legacy
    }
    throw error
  }
}

async function legacyVercelGet(pathname: string): Promise<{ bytes: Buffer; contentType: string | null } | null> {
  try {
    const result = await Promise.race([
      vercelGet(pathname, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ])
    if (!result || result.statusCode !== 200 || !result.stream) return null
    const chunks: Buffer[] = []
    const reader = result.stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }
    return { bytes: Buffer.concat(chunks), contentType: result.blob?.contentType ?? null }
  } catch {
    return null
  }
}

export async function chatStorageRemove(pathnames: string[]): Promise<void> {
  const safe = pathnames.filter((p) => ALLOWED_PATH.test(p) && !p.includes('..'))
  if (!safe.length) return
  const res = await call(`object/${CHAT_STORAGE_BUCKET}`, {
    method: 'DELETE',
    timeoutMs: WRITE_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: safe }),
  })
  if (!res.ok && res.status !== 404) throw await failure(res, 'delete')
  // Files uploaded before the switch live in Vercel Blob: remove them there too (best effort).
  // Hard 5 s cap: the legacy store must never hold a request open (it hung for > 1 min).
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await Promise.race([
      vercelDel(safe, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
  }
}

/** Files directly inside a folder (e.g. `chat-quick-replies/<tenant>`): count + bytes. */
export async function chatStorageUsage(folder: string): Promise<{ count: number; bytes: number }> {
  const prefix = folder.replace(/\/+$/, '')
  assertPath(`${prefix}/x`)
  return withBucket(async () => {
    let offset = 0
    let count = 0
    let bytes = 0
    for (;;) {
      const res = await call(`object/list/${CHAT_STORAGE_BUCKET}`, {
        method: 'POST',
        timeoutMs: META_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      })
      if (!res.ok) throw await failure(res, 'list')
      const rows = (await res.json()) as Array<{ id: string | null; metadata?: { size?: number } | null }>
      for (const row of rows) {
        if (!row.id) continue // sub-folder
        count += 1
        bytes += Number(row.metadata?.size) || 0
      }
      if (rows.length < 1000) break
      offset += rows.length
    }
    return { count, bytes }
  })
}
