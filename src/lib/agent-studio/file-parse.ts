/**
 * Parse an uploaded source file for "Crear desde fuentes": PDF (unpdf, no native deps, eval disabled),
 * DOCX (own bounded zip reader + word/document.xml, inflate hard-capped), plain text (UTF-8, no NULs), and product photos
 * (sharp normalize → JPEG ≤1600 px, metadata stripped). Type comes from MAGIC BYTES, never the file name.
 * Caps: 10 MB in, 60 PDF pages, 200k chars out, 20 s per parse.
 */
import 'server-only'

import { constants as zlibConstants, inflateRawSync, inflateSync } from 'node:zlib'
import { Worker } from 'node:worker_threads'
import sharp from 'sharp'
import { decodeEntities } from '@/lib/agent-studio/html-text'

// Below Next's 10 MiB middleware body limit (multipart overhead included).
export const MAX_UPLOAD_BYTES = 9 * 1024 * 1024
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

/** Central-directory pre-check before inflating a DOCX (zip bombs). Header sizes are attacker-controlled, so the
 * real guard is the hard output cap in inflateEntry; this only rejects obviously hostile archives early. */
export function docxZipLooksSafe(entries: Array<{ compressed: number; uncompressed: number }>): boolean {
  if (entries.length > 1000) return false
  let total = 0
  for (const e of entries) {
    total += e.uncompressed
    if (e.compressed > 0 && e.uncompressed / e.compressed > 100 && e.uncompressed > 1_000_000) return false
  }
  return total <= 40 * 1024 * 1024
}

const MAX_XML_BYTES = 8 * 1024 * 1024

type ZipEntry = { name: string; method: number; compressed: number; uncompressed: number; localOffset: number }

/** Minimal, bounds-checked zip central-directory reader (no decompression here). */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  const minEocd = Math.max(0, buf.length - 65_557)
  let eocd = -1
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new UploadParseError('not_docx')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  if (count > 1000) throw new UploadParseError('docx_too_big')
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new UploadParseError('not_docx')
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    if (off + 46 + nameLen > buf.length) throw new UploadParseError('not_docx')
    entries.push({
      name: buf.toString('utf8', off + 46, off + 46 + nameLen),
      method: buf.readUInt16LE(off + 10),
      compressed: buf.readUInt32LE(off + 20),
      uncompressed: buf.readUInt32LE(off + 24),
      localOffset: buf.readUInt32LE(off + 42),
    })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** Inflate ONE entry with a hard output cap (zlib stops at maxOutputLength whatever the header claims). */
function inflateEntry(buf: Buffer, e: ZipEntry): Buffer {
  const lo = e.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new UploadParseError('not_docx')
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28)
  const end = start + e.compressed
  if (end > buf.length) throw new UploadParseError('not_docx')
  const data = buf.subarray(start, end)
  if (e.method === 0) {
    if (data.length > MAX_XML_BYTES) throw new UploadParseError('docx_too_big')
    return Buffer.from(data)
  }
  if (e.method !== 8) throw new UploadParseError('not_docx')
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES })
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError) throw new UploadParseError('docx_too_big')
    throw new UploadParseError('not_docx')
  }
}

function parseDocx(bytes: Buffer): string {
  const entries = readZipEntries(bytes)
  if (!docxZipLooksSafe(entries)) throw new UploadParseError('docx_too_big')
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new UploadParseError('not_docx')
  const xml = inflateEntry(bytes, doc).toString('utf8')
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    // [^<>] keeps this linear on hostile input (a run of '<' with no '>' would make [^>]* quadratic).
    .replace(/<[^<>]*>/g, '')
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim()
}

// pdf.js runs in its own thread with a memory ceiling; on timeout the thread is terminated (a promise race alone
// would leave a hostile PDF burning CPU/memory in the main process).
const PDF_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } };
}
(async () => {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(workerData.bytes), { isEvalSupported: false });
  if (pdf.numPages > workerData.maxPages) return parentPort.postMessage({ ok: false, code: 'pdf_too_many_pages' });
  const { text } = await extractText(pdf, { mergePages: true });
  parentPort.postMessage({ ok: true, text: String(text).slice(0, workerData.maxText), pages: pdf.numPages });
})().catch(() => parentPort.postMessage({ ok: false, code: 'pdf_unreadable' }));
`

const PDF_STREAM_BUDGET = 64 * 1024 * 1024

/**
 * Pre-scan BEFORE pdf.js (the worker's heap limit does not cover pdf.js's decompressed Uint8Arrays): every
 * compressed content stream is inflated here with a hard budget. Encrypted PDFs (streams we cannot pre-check),
 * LZW, and doubly-compressed streams are refused. Images are skipped (text extraction never decodes them).
 */
export function pdfStreamsWithinBudget(buf: Buffer, budget = PDF_STREAM_BUDGET): boolean {
  const latin = buf.toString('latin1')
  if (latin.includes('/Encrypt')) throw new UploadParseError('pdf_protected')
  if (latin.includes('/LZWDecode')) throw new UploadParseError('pdf_unsupported')
  let total = 0
  let i = 0
  for (;;) {
    const s = latin.indexOf('stream', i)
    if (s < 0) break
    if (s >= 3 && latin.startsWith('end', s - 3)) {
      i = s + 6
      continue
    }
    let start = s + 6
    if (latin[start] === '\r') start += 1
    if (latin[start] === '\n') start += 1
    const end = latin.indexOf('endstream', start)
    if (end < 0) break
    const window = latin.slice(Math.max(0, s - 4000), s)
    const dictStart = window.lastIndexOf('<<')
    const dict = dictStart >= 0 ? window.slice(dictStart) : ''
    i = end + 9
    if (/\/Subtype\s*\/Image/.test(dict)) continue
    const flates = (dict.match(/\/FlateDecode|\/Fl\b/g) || []).length
    if (flates > 1) throw new UploadParseError('pdf_unsupported')
    if (flates === 1) {
      try {
        const out = inflateSync(buf.subarray(start, end), {
          maxOutputLength: budget - total + 1,
          finishFlush: zlibConstants.Z_SYNC_FLUSH,
        })
        total += out.length
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError) return false
        // Corrupt stream: pdf.js fails on it too; nothing big was produced here.
      }
    } else {
      total += end - start
    }
    if (total > budget) return false
  }
  return true
}

let activePdfWorkers = 0
const MAX_PDF_WORKERS = 1

function parsePdfInWorker(bytes: Buffer): Promise<{ text: string; pages: number }> {
  if (activePdfWorkers >= MAX_PDF_WORKERS) return Promise.reject(new UploadParseError('busy'))
  activePdfWorkers += 1
  return new Promise<{ text: string; pages: number }>((resolve, reject) => {
    const copy = new Uint8Array(bytes)
    const worker = new Worker(PDF_WORKER_SOURCE, {
      eval: true,
      workerData: { bytes: copy, maxPages: MAX_PDF_PAGES, maxText: MAX_TEXT },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64 },
    })
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(watch)
      void worker.terminate()
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new UploadParseError('timeout'))), PARSE_TIMEOUT_MS)
    // Backstop: memory outside the worker heap (typed arrays) is watched from here; past +1 GB the worker dies.
    const baseRss = process.memoryUsage().rss
    const watch = setInterval(() => {
      if (process.memoryUsage().rss - baseRss > 1024 * 1024 * 1024) done(() => reject(new UploadParseError('pdf_too_big')))
    }, 100)
    worker.once('message', (m: { ok: boolean; text?: string; pages?: number; code?: string }) =>
      done(() => (m.ok ? resolve({ text: m.text || '', pages: m.pages || 0 }) : reject(new UploadParseError(m.code || 'pdf_unreadable')))),
    )
    worker.once('error', () => done(() => reject(new UploadParseError('pdf_unreadable'))))
    worker.once('exit', () => done(() => reject(new UploadParseError('pdf_unreadable'))))
  }).finally(() => {
    activePdfWorkers -= 1
  })
}

export async function parseUpload(bytes: Buffer): Promise<ParsedUpload> {
  if (bytes.length === 0) throw new UploadParseError('empty')
  if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadParseError('too_large')
  const kind = sniffUploadKind(bytes)
  switch (kind) {
    case 'pdf': {
      if (!pdfStreamsWithinBudget(bytes)) throw new UploadParseError('pdf_too_big')
      const { text, pages } = await parsePdfInWorker(bytes)
      return { kind: 'pdf', mime: 'application/pdf', text: text.slice(0, MAX_TEXT), pageCount: pages }
    }
    case 'zip': {
      const text = parseDocx(bytes)
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
