/**
 * Outbound chat media (WhatsApp Cloud API) — validation only, no I/O.
 * The file type is decided from the bytes (magic numbers) + extension allow-list;
 * the browser-reported MIME type is never trusted.
 */

import { CHAT_MEDIA_MAX_BYTES } from '@/lib/chat-media'

/** Per-business switch (TenantFeatureFlag key). Off until tested on a real line. */
export const CHAT_OUTBOUND_MEDIA_FLAG = 'chat_outbound_media_v1'

export type OutboundMediaKind = 'image' | 'video' | 'audio' | 'document'

export type OutboundMediaClassification =
  | { ok: true; kind: OutboundMediaKind; mime: string; filename: string; size: number }
  | { ok: false; error: string }

const MB = 1024 * 1024

/** Meta WhatsApp limits, capped by our media cache size. */
export const WA_OUTBOUND_LIMITS: Record<OutboundMediaKind, number> = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  document: Math.min(100 * MB, CHAT_MEDIA_MAX_BYTES),
}

/** Accept list for the file picker (UI hint only; the server re-validates). */
export const WA_OUTBOUND_ACCEPT =
  '.jpg,.jpeg,.png,.mp4,.3gp,.aac,.mp3,.m4a,.amr,.ogg,.opus,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt'

const DOCUMENT_BY_EXT: Record<string, { mime: string; magic: 'pdf' | 'zip' | 'ole' | 'text' }> = {
  pdf: { mime: 'application/pdf', magic: 'pdf' },
  doc: { mime: 'application/msword', magic: 'ole' },
  xls: { mime: 'application/vnd.ms-excel', magic: 'ole' },
  ppt: { mime: 'application/vnd.ms-powerpoint', magic: 'ole' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' },
  txt: { mime: 'text/plain', magic: 'text' },
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  return sig.every((b, i) => bytes[offset + i] === b)
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + len))
}

/** Magic-number sniff for the media types WhatsApp accepts. */
export function sniffMediaMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf' // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip' // docx/xlsx/pptx
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/x-ole' // doc/xls/ppt
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg' // OggS
  if (startsWith(bytes, [0x23, 0x21, 0x41, 0x4d, 0x52])) return 'audio/amr' // #!AMR
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (brand.startsWith('3gp') || brand.startsWith('3g2')) return 'video/3gpp'
    if (brand.startsWith('m4a')) return 'audio/mp4'
    return 'video/mp4'
  }
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return 'audio/mpeg' // ID3
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'audio/aac' // ADTS
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg' // MPEG frame
  return null
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 2048)
  for (const b of sample) {
    if (b === 0) return false
  }
  return true
}

/** Keep a readable name without paths, control characters or quotes. */
export function sanitizeOutboundFilename(name: string, fallbackExt: string): string {
  const base = (name.split(/[\\/]/).pop() || '')
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .trim()
    .slice(0, 120)
  return base || `archivo.${fallbackExt}`
}

export function classifyOutboundMedia(input: {
  filename: string
  bytes: Uint8Array
}): OutboundMediaClassification {
  const size = input.bytes.length
  if (size === 0) return { ok: false, error: 'El archivo está vacío.' }
  const ext = (input.filename.split('.').pop() || '').toLowerCase()
  const sniffed = sniffMediaMime(input.bytes)

  let kind: OutboundMediaKind | null = null
  let mime: string | null = null

  if (sniffed === 'image/jpeg' || sniffed === 'image/png') {
    kind = 'image'
    mime = sniffed
  } else if (sniffed === 'video/mp4' || sniffed === 'video/3gpp') {
    kind = 'video'
    mime = sniffed
  } else if (sniffed && sniffed.startsWith('audio/')) {
    kind = 'audio'
    // WhatsApp wants audio/ogg only for opus voice notes; other audio keeps its sniffed type.
    mime = sniffed
  } else if (DOCUMENT_BY_EXT[ext]) {
    const doc = DOCUMENT_BY_EXT[ext]
    const matches =
      (doc.magic === 'pdf' && sniffed === 'application/pdf') ||
      (doc.magic === 'zip' && sniffed === 'application/zip') ||
      (doc.magic === 'ole' && sniffed === 'application/x-ole') ||
      (doc.magic === 'text' && sniffed === null && looksLikeText(input.bytes))
    if (matches) {
      kind = 'document'
      mime = doc.mime
    }
  }

  if (!kind || !mime) {
    return {
      ok: false,
      error: 'Tipo de archivo no admitido. Enviá fotos JPG/PNG, videos MP4, audios o documentos PDF, Word, Excel, PowerPoint o TXT.',
    }
  }
  const limit = WA_OUTBOUND_LIMITS[kind]
  if (size > limit) {
    return { ok: false, error: `El archivo supera el máximo de ${Math.round(limit / MB)} MB para este tipo.` }
  }
  return { ok: true, kind, mime, size, filename: sanitizeOutboundFilename(input.filename, ext || 'bin') }
}

/** Stored text for the outbound bubble / list preview. */
export function outboundMediaContent(kind: OutboundMediaKind, caption: string): string {
  const trimmed = caption.trim()
  if (trimmed) return trimmed
  return { image: '[image]', video: '[video]', audio: '[audio]', document: '[document]' }[kind]
}

/** WhatsApp Cloud API message body for an uploaded media id. */
export function buildWhatsAppMediaMessage(args: {
  to: string
  kind: OutboundMediaKind
  mediaId: string
  caption?: string
  filename?: string
}): Record<string, unknown> {
  const media: Record<string, unknown> = { id: args.mediaId }
  const caption = args.caption?.trim()
  if (caption && args.kind !== 'audio') media.caption = caption.slice(0, 1024)
  if (args.kind === 'document' && args.filename) media.filename = args.filename
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: args.kind,
    [args.kind]: media,
  }
}
