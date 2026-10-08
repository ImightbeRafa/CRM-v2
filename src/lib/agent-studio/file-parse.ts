/**
 * Parse an uploaded source file for "Crear desde fuentes": PDF (unpdf, no native deps, eval disabled),
 * DOCX (jszip + word/document.xml, zip-bomb pre-checks), plain text (UTF-8, no NULs), and product photos
 * (sharp normalize → JPEG ≤1600 px, metadata stripped). Type comes from MAGIC BYTES, never the file name.
 * Caps: 10 MB in, 60 PDF pages, 200k chars out, 20 s per parse.
 */
import 'server-only'

import JSZip from 'jszip'
import sharp from 'sharp'
import { decodeEntities } from '@/lib/agent-studio/html-text'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_PDF_PAGES = 60
const MAX_TEXT = 200_000
const PARSE_TIMEOUT_MS = 20_000

export type ParsedUpload =
  | { kind: 'pdf' | 'docx' | 'txt'; mime: string; text: string; pageCount: number | null }
  | { kind: 'image'; mime: 'image/jpeg'; jpeg: Buffer; width: number; height: number }

export class UploadParseError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'UploadParseError'
  }
}

function startsWith(b: Uint8Array, sig: number[]): boolean {
  return sig.every((v, i) => b[i] === v)
}

export function sniffUploadKind(b: Uint8Array): 'pdf' | 'zip' | 'jpeg' | 'png' | 'webp' | 'text' | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  // Plain text: valid UTF-8, no NUL bytes.
  if (!b.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 64_000)))
      return 'text'
    } catch {
      return null
    }
  }
  return null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new UploadParseError('timeout')), ms)
    }),
  ]).finally(() => clearTimeout(t))
}

/** Central-directory pre-check before inflating a DOCX (zip bombs). */
export function docxZipLooksSafe(entries: Array<{ compressed: number; uncompressed: number }>): boolean {
  if (entries.length > 1000) return false
  let total = 0
  for (const e of entries) {
    total += e.uncompressed
    if (e.compressed > 0 && e.uncompressed / e.compressed > 100 && e.uncompressed > 1_000_000) return false
  }
  return total <= 40 * 1024 * 1024
}

async function parseDocx(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const entries = Object.values(zip.files).map((f) => {
    const d = (f as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } })._data
    return { compressed: d?.compressedSize ?? 0, uncompressed: d?.uncompressedSize ?? 0 }
  })
  if (!docxZipLooksSafe(entries)) throw new UploadParseError('docx_too_big')
  const doc = zip.file('word/document.xml')
  if (!doc) throw new UploadParseError('not_docx')
  const xml = await doc.async('string')
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim()
}

async function parsePdf(bytes: Buffer): Promise<{ text: string; pages: number }> {
  // pdf.js (bundled in unpdf) uses Promise.withResolvers (Node 22+); production runs Node 20.
  const P = Promise as unknown as { withResolvers?: unknown }
  if (typeof P.withResolvers !== 'function') {
    ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers() {
      let resolve!: (v: unknown) => void
      let reject!: (e: unknown) => void
      const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }
  }
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false } as never)
  if (pdf.numPages > MAX_PDF_PAGES) throw new UploadParseError('pdf_too_many_pages')
  const { text } = await extractText(pdf, { mergePages: true })
  return { text: String(text), pages: pdf.numPages }
}

export async function parseUpload(bytes: Buffer): Promise<ParsedUpload> {
  if (bytes.length === 0) throw new UploadParseError('empty')
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadParseError('too_large')
  const kind = sniffUploadKind(bytes)
  switch (kind) {
    case 'pdf': {
      const { text, pages } = await withTimeout(parsePdf(bytes), PARSE_TIMEOUT_MS)
      return { kind: 'pdf', mime: 'application/pdf', text: text.slice(0, MAX_TEXT), pageCount: pages }
    }
    case 'zip': {
      const text = await withTimeout(parseDocx(bytes), PARSE_TIMEOUT_MS)
      return {
        kind: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        text: text.slice(0, MAX_TEXT),
        pageCount: null,
      }
    }
    case 'text':
      return { kind: 'txt', mime: 'text/plain', text: bytes.toString('utf8').slice(0, MAX_TEXT), pageCount: null }
    case 'jpeg':
    case 'png':
    case 'webp': {
      const out = await withTimeout(
        sharp(bytes, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer({ resolveWithObject: true }),
        PARSE_TIMEOUT_MS,
      )
      if (out.data.length > 5 * 1024 * 1024) throw new UploadParseError('image_too_large')
      return { kind: 'image', mime: 'image/jpeg', jpeg: out.data, width: out.info.width, height: out.info.height }
    }
    default:
      throw new UploadParseError('unsupported_type')
  }
}
