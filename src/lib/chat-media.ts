/**
 * Chat-only Meta media fetch + private Vercel Blob cache.
 * Never import bot modules; never persist Meta CDN URLs on ChatMessage.
 */

import { get, put, type BlobAccessType } from '@vercel/blob'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'

export const CHAT_MEDIA_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_MEDIA_BLOB_PREFIX = 'chat-media'

export type ChatMediaCacheStatus = 'pending' | 'ready' | 'failed' | 'too_large'

export type ChatMediaBlobRef = {
  mediaBlobPath: string
  mediaCacheStatus: ChatMediaCacheStatus
  mediaMimeType?: string | null
  mediaFilename?: string | null
}

/** Reject accidental persistence of Meta CDN URLs in metadata / columns. */
export function isMetaCdnUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return (
      host.endsWith('fbcdn.net') ||
      host.endsWith('cdninstagram.com') ||
      host.endsWith('fbsbx.com') ||
      host.includes('scontent.') ||
      host.endsWith('facebook.com')
    )
  } catch {
    return false
  }
}

export function chatMediaBlobPath(tenantId: string, messageId: string): string {
  return `${CHAT_MEDIA_BLOB_PREFIX}/${tenantId}/${messageId}`
}

export function stripMetaCdnFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {}
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && isMetaCdnUrl(value)) continue
    if (key === 'mediaUrl' || key === 'cdnUrl' || key === 'attachmentUrl') {
      if (typeof value === 'string' && isMetaCdnUrl(value)) continue
    }
    next[key] = value
  }
  return next
}

export function readMediaBlobRefFromMessage(message: {
  mediaBlobPath?: string | null
  mediaCacheStatus?: string | null
  mediaMimeType?: string | null
  mediaFilename?: string | null
  metadata?: unknown
}): ChatMediaBlobRef | null {
  const meta =
    message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : null
  const path =
    (typeof message.mediaBlobPath === 'string' && message.mediaBlobPath) ||
    (typeof meta?.mediaBlobPath === 'string' ? meta.mediaBlobPath : null)
  if (!path || isMetaCdnUrl(path)) return null
  const statusRaw =
    (typeof message.mediaCacheStatus === 'string' && message.mediaCacheStatus) ||
    (typeof meta?.mediaCacheStatus === 'string' ? meta.mediaCacheStatus : 'ready')
  const status = (['pending', 'ready', 'failed', 'too_large'].includes(statusRaw)
    ? statusRaw
    : 'ready') as ChatMediaCacheStatus
  return {
    mediaBlobPath: path,
    mediaCacheStatus: status,
    mediaMimeType:
      message.mediaMimeType ??
      (typeof meta?.mediaMimeType === 'string' ? meta.mediaMimeType : null),
    mediaFilename:
      message.mediaFilename ??
      (typeof meta?.mediaFilename === 'string' ? meta.mediaFilename : null),
  }
}

export async function resolveMetaMediaDownloadUrl(opts: {
  providerMediaId: string
  accessToken: string
  /** WA Graph secret for WhatsApp media; default Meta secret otherwise. */
  purpose?: 'whatsapp' | 'default'
  fetchImpl?: typeof fetch
}): Promise<{ url: string; mimeType: string | null }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const mediaId = opts.providerMediaId.trim()
  if (!mediaId) throw new Error('Missing providerMediaId')

  const graphUrl = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(mediaId)}?fields=url,mime_type`),
    opts.accessToken,
    { purpose: opts.purpose ?? 'whatsapp' },
  )
  const res = await fetchImpl(graphUrl, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json().catch(() => ({}))) as {
    url?: string
    mime_type?: string
    error?: { message?: string }
  }
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message || 'Failed to resolve Meta media URL')
  }
  // Temporary Graph URL — caller must download, never persist.
  return {
    url: data.url,
    mimeType: data.mime_type ? String(data.mime_type) : null,
  }
}

/**
 * Stream-download with a hard byte cap. Rejects if Content-Length exceeds cap
 * or if cumulative bytes exceed cap mid-stream.
 */
export async function downloadMetaMediaWithCap(opts: {
  url: string
  accessToken: string
  maxBytes?: number
  fetchImpl?: typeof fetch
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  const maxBytes = opts.maxBytes ?? CHAT_MEDIA_MAX_BYTES
  if (isMetaCdnUrl(opts.url) === false && !opts.url.startsWith('https://')) {
    throw new Error('Invalid media download URL')
  }

  const fetchImpl = opts.fetchImpl ?? fetch
  const res = await fetchImpl(opts.url, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    throw new Error(`Media download failed (${res.status})`)
  }

  const contentLength = Number(res.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const err = new Error('Media exceeds size cap') as Error & { code: string }
    err.code = 'too_large'
    throw err
  }

  const contentType = res.headers.get('content-type')
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) {
      const err = new Error('Media exceeds size cap') as Error & { code: string }
      err.code = 'too_large'
      throw err
    }
    return { bytes: buf, contentType }
  }

  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      const err = new Error('Media exceeds size cap') as Error & { code: string }
      err.code = 'too_large'
      throw err
    }
    chunks.push(Buffer.from(value))
  }
  return { bytes: Buffer.concat(chunks), contentType }
}

function isPublicStorePrivateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /private access on a public store/i.test(msg)
}

export async function putChatMediaToBlob(opts: {
  tenantId: string
  messageId: string
  bytes: Buffer
  contentType: string
  token?: string
}): Promise<{ pathname: string; size: number }> {
  const token = opts.token ?? process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required for chat media cache')

  const pathname = chatMediaBlobPath(opts.tenantId, opts.messageId)
  const access: BlobAccessType = 'private'
  try {
    const result = await put(pathname, opts.bytes, {
      access,
      token,
      contentType: opts.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return { pathname: result.pathname, size: opts.bytes.length }
  } catch (err) {
    if (isPublicStorePrivateError(err)) {
      throw new Error(
        'Chat media cache requires a private Vercel Blob store (BLOB_READ_WRITE_TOKEN).',
      )
    }
    throw err
  }
}

export async function readChatMediaFromBlob(opts: {
  pathname: string
  token?: string
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  const token = opts.token ?? process.env.BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required for chat media cache')
  if (isMetaCdnUrl(opts.pathname)) {
    throw new Error('Refusing to read Meta CDN path as blob')
  }

  const result = await get(opts.pathname, { access: 'private', token })
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`Blob not found or unreadable: ${opts.pathname}`)
  }
  const chunks: Buffer[] = []
  const reader = result.stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return {
    bytes: Buffer.concat(chunks),
    contentType: result.blob?.contentType ?? null,
  }
}

export type CacheChatMediaResult =
  | { ok: true; ref: ChatMediaBlobRef; bytes: Buffer }
  | { ok: false; status: ChatMediaCacheStatus; error: string }

/**
 * Resolve → download (capped) → put private blob. Returns bytes for immediate streaming.
 * Does not write Meta CDN URLs into the returned ref.
 */
export async function cacheProviderMediaToBlob(opts: {
  tenantId: string
  messageId: string
  providerMediaId: string
  accessToken: string
  /** Callers may pass channel platform; non-WA maps to default Meta app secret. */
  purpose?: 'whatsapp' | 'instagram' | 'meta' | 'default'
  mimeHint?: string | null
  filenameHint?: string | null
  fetchImpl?: typeof fetch
  putFn?: typeof putChatMediaToBlob
}): Promise<CacheChatMediaResult> {
  try {
    const proofPurpose: 'whatsapp' | 'default' =
      opts.purpose === 'whatsapp' ? 'whatsapp' : 'default'
    const resolved = await resolveMetaMediaDownloadUrl({
      providerMediaId: opts.providerMediaId,
      accessToken: opts.accessToken,
      purpose: proofPurpose,
      fetchImpl: opts.fetchImpl,
    })
    const downloaded = await downloadMetaMediaWithCap({
      url: resolved.url,
      accessToken: opts.accessToken,
      fetchImpl: opts.fetchImpl,
    })
    const contentType =
      downloaded.contentType || resolved.mimeType || opts.mimeHint || 'application/octet-stream'
    const putFn = opts.putFn ?? putChatMediaToBlob
    const stored = await putFn({
      tenantId: opts.tenantId,
      messageId: opts.messageId,
      bytes: downloaded.bytes,
      contentType,
    })
    if (isMetaCdnUrl(stored.pathname)) {
      return { ok: false, status: 'failed', error: 'Blob path looked like Meta CDN' }
    }
    return {
      ok: true,
      bytes: downloaded.bytes,
      ref: {
        mediaBlobPath: stored.pathname,
        mediaCacheStatus: 'ready',
        mediaMimeType: contentType,
        mediaFilename: opts.filenameHint ?? null,
      },
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: string }).code) : ''
    if (code === 'too_large') {
      return { ok: false, status: 'too_large', error: 'Media exceeds 10MB cap' }
    }
    return {
      ok: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Media cache failed',
    }
  }
}

/** Pure helper for tests: metadata patch must never include Meta CDN URLs. */
export function buildMediaCacheMetadataPatch(
  existing: Record<string, unknown> | null | undefined,
  ref: ChatMediaBlobRef,
): Record<string, unknown> {
  const base = stripMetaCdnFromMetadata(existing)
  return {
    ...base,
    mediaBlobPath: ref.mediaBlobPath,
    mediaCacheStatus: ref.mediaCacheStatus,
    ...(ref.mediaMimeType ? { mediaMimeType: ref.mediaMimeType } : {}),
    ...(ref.mediaFilename ? { mediaFilename: ref.mediaFilename } : {}),
  }
}
