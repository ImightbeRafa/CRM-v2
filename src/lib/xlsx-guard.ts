/**
 * xlsx zip-bomb guard (security, 2026-09-28; real sizes 2026-09-29).
 *
 * ExcelJS (via JSZip) inflates every entry in memory before it notices a declared size is wrong,
 * so trusting the central directory's "uncompressed size" let a 255 KB upload inflate 256 MB
 * (SecureDog H2: a 10 MB upload ≈ 10 GB → the container dies for every tenant). This guard really
 * inflates each entry with a hard output cap, and requires the real size to equal the declared
 * one, before ExcelJS sees the file. It also refuses layouts JSZip would read differently from us
 * (a gap between the central directory and its end record shifts JSZip's offsets).
 */
import 'server-only'
import zlib from 'node:zlib'

export const XLSX_MAX_ENTRIES = 1000
/** Real total of all inflated entries. ExcelJS's in-memory model is several times this. */
export const XLSX_MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024

const BAD = 'El archivo Excel no es válido o es demasiado grande al descomprimir.'

/** An error message, or null when the archive is safe to hand to ExcelJS. */
export function xlsxArchiveProblem(buf: Uint8Array): string | null {
  try {
    return inspect(buf)
  } catch {
    return BAD
  }
}

function inspect(buf: Uint8Array): string | null {
  if (buf.length < 22) return BAD
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return BAD
  const entries = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (entries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) return BAD // ZIP64
  if (entries === 0 || entries > XLSX_MAX_ENTRIES) return BAD
  // The directory must end exactly where its end record starts (no offset shifting).
  if (cdOffset + cdSize !== eocd) return BAD

  let p = cdOffset
  let total = 0
  for (let n = 0; n < entries; n++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) return BAD
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const compressed = view.getUint32(p + 20, true)
    const declared = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    if (flags & 0x1) return BAD // encrypted
    if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) return BAD

    if (local + 30 > cdOffset || view.getUint32(local, true) !== 0x04034b50) return BAD
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const dataEnd = dataStart + compressed
    if (dataEnd > cdOffset) return BAD

    const budget = XLSX_MAX_UNCOMPRESSED_BYTES - total
    let real: number
    if (method === 0) {
      real = compressed
    } else if (method === 8) {
      let out: Buffer
      try {
        // maxOutputLength throws once the budget is exceeded: memory stays bounded.
        out = zlib.inflateRawSync(buf.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, budget + 1) })
      } catch {
        return BAD
      }
      real = out.length
    } else {
      return BAD
    }
    if (real !== declared) return BAD
    total += real
    if (total > XLSX_MAX_UNCOMPRESSED_BYTES) return BAD
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}
