/**
 * Chat-only Meta media fetch + private Vercel Blob cache.
 * Never import bot modules; never persist Meta CDN URLs on ChatMessage.
 */

import { chatStorageGet, chatStoragePut, chatStorageRemove, chatStorageUsage, ChatStorageError } from '@/lib/chat-storage'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'

// WhatsApp caps video/audio at 16 MB; 25 MB leaves headroom. Documents above this
// show a "too large" notice instead of streaming.
export const CHAT_MEDIA_MAX_BYTES = 25 * 1024 * 1024
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

/** Hosts we are willing to DOWNLOAD from (exact or dot-boundary subdomain only). */
const META_MEDIA_DOWNLOAD_DOMAINS = ['fbcdn.net', 'cdninstagram.com', 'fbsbx.com']

/**
 * Strict allow-list for server-side downloads of Instagram attachment URLs.
 * `isMetaCdnUrl` is intentionally broad (it only strips URLs from metadata) and must
 * never gate a fetch: it accepts e.g. `scontent.evil.com` or `evilfbcdn.net`.
 */
export function isAllowedMetaMediaDownloadUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  return META_MEDIA_DOWNLOAD_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
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
  /** Instagram attachment URLs are pre-signed CDN links: never send the page token there. */
  sendAuth?: boolean
  /**
   * Untrusted URL (Instagram payload): follow redirects manually and re-check every hop
   * against `isAllowedMetaMediaDownloadUrl` (max 3). Default: platform fetch behavior.
   */
  strictHosts?: boolean
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  const maxBytes = opts.maxBytes ?? CHAT_MEDIA_MAX_BYTES
  if (isMetaCdnUrl(opts.url) === false && !opts.url.startsWith('https://')) {
    throw new Error('Invalid media download URL')
  }
  if (opts.strictHosts && !isAllowedMetaMediaDownloadUrl(opts.url)) {
    throw new Error('Media host not allowed')
  }

  const fetchImpl = opts.fetchImpl ?? fetch
  const headers: Record<string, string> =
    opts.sendAuth === false ? {} : { Authorization: `Bearer ${opts.accessToken}` }
  let currentUrl = opts.url
  let res: Response
  // One budget for the whole download (all redirect hops together).
  const signal = AbortSignal.timeout(60_000)
  for (let hop = 0; ; hop += 1) {
    res = await fetchImpl(currentUrl, {
      headers,
      signal,
      ...(opts.strictHosts ? { redirect: 'manual' as const } : {}),
    })
    if (!opts.strictHosts || res.status < 300 || res.status >= 400) break
    try {
      await res.body?.cancel()
    } catch {
      // ignore: we never read redirect bodies
    }
    const location = res.headers.get('location')
    const next = location ? new URL(location, currentUrl).toString() : ''
    if (hop >= 3 || !isAllowedMetaMediaDownloadUrl(next)) {
      throw new Error('Media redirect not allowed')
    }
    currentUrl = next
  }
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

/**
 * Private copy of a chat file (Supabase Storage, see chat-storage.ts). The name is kept from the
 * Vercel Blob era so callers and tests stay unchanged.
 */
export async function putChatMediaToBlob(opts: {
  tenantId: string
  messageId: string
  bytes: Buffer
  contentType: string
  /** Explicit private path (quick-reply files); default `chat-media/<tenant>/<message>`. */
  pathname?: string
}): Promise<{ pathname: string; size: number }> {
  if (opts.pathname && !/^(chat-media|chat-quick-replies)\//.test(opts.pathname)) {
    throw new Error('Refusing to write outside the chat media folders')
  }
  const pathname = opts.pathname ?? chatMediaBlobPath(opts.tenantId, opts.messageId)
  // The media cache may re-write the same message file; quick-reply files get fresh names.
  return chatStoragePut(pathname, opts.bytes, opts.contentType, { overwrite: !opts.pathname })
}

export async function readChatMediaFromBlob(opts: {
  pathname: string
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  if (isMetaCdnUrl(opts.pathname)) {
    throw new Error('Refusing to read Meta CDN path as blob')
  }
  return chatStorageGet(opts.pathname)
}

/**
 * `ok: true` always carries the downloaded bytes. `ref.mediaCacheStatus` is `'ready'` only when the
 * private Blob write worked; otherwise (`cacheError` set) the bytes are still served so the chat
 * never shows "No se pudo mostrar" just because the cache store is missing or unreachable.
 */
export type CacheChatMediaResult =
  | { ok: true; ref: ChatMediaBlobRef; bytes: Buffer; cacheError?: string }
  | { ok: false; status: ChatMediaCacheStatus; error: string }

const GENERIC_CONTENT_TYPE = /^(application\/octet-stream|binary\/octet-stream|application\/binary|text\/plain)?$/i

/**
 * First specific media type among the candidates (Graph `mime_type` is authoritative; CDN
 * responses sometimes say `application/octet-stream`, which the browser will not render
 * under `nosniff`).
 */
export function pickMediaContentType(...candidates: Array<string | null | undefined>): string {
  for (const raw of candidates) {
    const value = String(raw || '').trim()
    const essence = value.split(';')[0].trim()
    if (essence && !GENERIC_CONTENT_TYPE.test(essence)) return value
  }
  return 'application/octet-stream'
}

async function storeDownloadedMedia(opts: {
  tenantId: string
  messageId: string
  bytes: Buffer
  contentType: string
  filename: string | null
  putFn?: typeof putChatMediaToBlob
}): Promise<CacheChatMediaResult> {
  const putFn = opts.putFn ?? putChatMediaToBlob
  try {
    const stored = await putFn({
      tenantId: opts.tenantId,
      messageId: opts.messageId,
      bytes: opts.bytes,
      contentType: opts.contentType,
    })
    if (isMetaCdnUrl(stored.pathname)) {
      return { ok: false, status: 'failed', error: 'Blob path looked like Meta CDN' }
    }
    return {
      ok: true,
      bytes: opts.bytes,
      ref: {
        mediaBlobPath: stored.pathname,
        mediaCacheStatus: 'ready',
        mediaMimeType: opts.contentType,
        mediaFilename: opts.filename,
      },
    }
  } catch (error) {
    const cacheError = error instanceof Error ? error.message : 'Blob write failed'
    console.warn('[chat-media] cache write failed; serving without cache:', cacheError)
    return {
      ok: true,
      bytes: opts.bytes,
      cacheError,
      ref: { mediaBlobPath: '', mediaCacheStatus: 'pending', mediaMimeType: opts.contentType, mediaFilename: opts.filename },
    }
  }
}

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
    return await storeDownloadedMedia({
      tenantId: opts.tenantId,
      messageId: opts.messageId,
      bytes: downloaded.bytes,
      contentType: pickMediaContentType(resolved.mimeType, downloaded.contentType, opts.mimeHint),
      filename: opts.filenameHint ?? null,
      putFn: opts.putFn,
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: string }).code) : ''
    if (code === 'too_large') {
      return { ok: false, status: 'too_large', error: 'Media exceeds 25MB cap' }
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

/**
 * Instagram sends attachments as pre-signed Meta CDN URLs (no media id). The URL is
 * only read from the stored webhook payload at download time and is never returned
 * to the client. Only https Meta CDN hosts are accepted (no SSRF to arbitrary hosts).
 */
export function instagramAttachmentUrl(metadata: unknown): string | null {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, any>)
      : null
  const attachments = meta?.rawMessage?.attachments
  const url = Array.isArray(attachments) ? attachments[0]?.payload?.url : null
  if (typeof url !== 'string') return null
  return isAllowedMetaMediaDownloadUrl(url) ? url : null
}

/** Download a pre-signed Instagram attachment (no token sent) and cache it privately. */
export async function cacheInstagramAttachmentToBlob(opts: {
  tenantId: string
  messageId: string
  url: string
  mimeHint?: string | null
  fetchImpl?: typeof fetch
  putFn?: typeof putChatMediaToBlob
}): Promise<CacheChatMediaResult> {
  try {
    if (!isAllowedMetaMediaDownloadUrl(opts.url)) {
      return { ok: false, status: 'failed', error: 'Invalid Instagram attachment URL' }
    }
    const downloaded = await downloadMetaMediaWithCap({
      url: opts.url,
      accessToken: '',
      sendAuth: false,
      strictHosts: true,
      fetchImpl: opts.fetchImpl,
    })
    return await storeDownloadedMedia({
      tenantId: opts.tenantId,
      messageId: opts.messageId,
      bytes: downloaded.bytes,
      contentType: pickMediaContentType(downloaded.contentType, opts.mimeHint),
      filename: null,
      putFn: opts.putFn,
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: string }).code) : ''
    if (code === 'too_large') return { ok: false, status: 'too_large', error: 'Media exceeds 25MB cap' }
    return { ok: false, status: 'failed', error: error instanceof Error ? error.message : 'Media cache failed' }
  }
}

const INLINE_MEDIA_TYPE = /^(image\/(jpeg|png|gif|webp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf)$/

/**
 * Headers for serving customer-controlled bytes from the Betsy origin. Only plain
 * images, audio, video and PDF render inline; anything else (HTML, SVG, XML, unknown)
 * is forced to download as octet-stream. Non-PDF responses also get a sandbox CSP so
 * nothing served here can run script as the logged-in user.
 */
export function safeMediaServeHeaders(
  contentType: string | null | undefined,
  filename?: string | null,
): Record<string, string> {
  // Only the base type is echoed (lower-case, no parameters, no CR/LF).
  const essence = String(contentType || '').split(';')[0].trim().toLowerCase()
  const disposition = (kind: 'inline' | 'attachment') => {
    const safe = String(filename || '')
      .replace(/[\u0000-\u001f\u007f"\\/]/g, '')
      .trim()
      .slice(0, 150)
    return safe ? `${kind}; filename*=UTF-8''${encodeURIComponent(safe)}` : kind
  }
  if (INLINE_MEDIA_TYPE.test(essence)) {
    return essence === 'application/pdf'
      ? { 'Content-Type': essence, 'Content-Disposition': disposition('inline') }
      : {
          'Content-Type': essence,
          'Content-Disposition': disposition('inline'),
          'Content-Security-Policy': "sandbox; default-src 'none'",
        }
  }
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': disposition('attachment'),
    'Content-Security-Policy': "sandbox; default-src 'none'",
  }
}

/**
 * Single `bytes=` range for media playback (iOS Safari probes with `bytes=0-1`).
 * Returns null when there is no usable Range header (serve 200), or 'unsatisfiable'.
 */
export function parseSingleByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null // multi-range or malformed: fall back to full body
  const [, startRaw, endRaw] = match
  let start: number
  let end: number
  if (startRaw === '' && endRaw === '') return null
  if (startRaw === '') {
    const suffix = Number(endRaw)
    if (suffix <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startRaw)
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unsatisfiable'
  // RFC 9110: a syntactically invalid range (last < first) is ignored → full 200.
  if (startRaw !== '' && endRaw !== '' && Number(endRaw) < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end }
}

/** Count / bytes of stored chat files in a folder (quota checks). */
export async function chatBlobUsage(prefix: string): Promise<{ count: number; bytes: number }> {
  return chatStorageUsage(prefix)
}

/** Delete chat files (only chat folders). */
export async function deleteChatBlobs(pathnames: string[]): Promise<void> {
  await chatStorageRemove(pathnames)
}

/**
 * Safe category for a Vercel Blob failure (shown to admins / logged). Never includes the token.
 */
export function describeBlobError(error: unknown): { code: string; message: string; detail: string } {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (error instanceof ChatStorageError) {
    const detail = raw.slice(0, 300)
    const byCode: Record<string, string> = {
      not_configured: 'falta configurar el almacenamiento.',
      not_found: 'el archivo no existe en el almacenamiento.',
      rejected: 'el almacenamiento rechazó la credencial.',
      timeout: 'el almacenamiento tardó demasiado, probá de nuevo.',
      network: 'no hubo conexión con el almacenamiento, probá de nuevo.',
      failed: 'error del almacenamiento.',
    }
    return { code: `storage_${error.code}`, message: byCode[error.code] ?? 'error del almacenamiento.', detail }
  }
  const detail = raw.replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, '[token]').slice(0, 300)
  const m = raw.toLowerCase()
  if (m.includes('blob_read_write_token is required') || m.includes('no token found')) {
    return { code: 'token_missing', message: 'falta configurar el almacenamiento (token).', detail }
  }
  if (m.includes('private access on a public store') || m.includes('requires a private vercel blob store')) {
    return { code: 'store_public', message: 'el almacenamiento no es privado.', detail }
  }
  if (m.includes('access denied') || m.includes('forbidden') || m.includes('unauthorized') || m.includes('invalid token')) {
    return { code: 'token_rejected', message: 'el almacenamiento rechazó la credencial.', detail }
  }
  if (m.includes('suspended') || m.includes('quota') || m.includes('limit')) {
    return { code: 'store_limit', message: 'el almacenamiento alcanzó su límite.', detail }
  }
  if (m.includes('already exists')) return { code: 'exists', message: 'nombre de archivo repetido, probá de nuevo.', detail }
  if (m.includes('fetch failed') || m.includes('network') || m.includes('timeout') || m.includes('econn')) {
    return { code: 'network', message: 'no hubo conexión con el almacenamiento, probá de nuevo.', detail }
  }
  return { code: 'unknown', message: 'error del almacenamiento.', detail }
}
