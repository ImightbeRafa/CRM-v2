/**
 * xlsx zip-bomb guard (security, 2026-09-28; real sizes 2026-09-29).
 *
 * ExcelJS (via JSZip) inflates every entry in memory before it notices a declared size is wrong,
 * so trusting the central directory's "uncompressed size" let a 255 KB upload inflate 256 MB
 * (SecureDog H2: a 10 MB upload ≈ 10 GB → the container dies for every tenant). This guard really
 * inflates each entry with a hard output cap, and requires the real size to equal the declared
 * one, before ExcelJS sees the file. It also refuses layouts JSZip would read differently from us
 * (a gap between the central directory and its end record shifts JSZip's offsets; the multi-disk
 * end-record fields switch JSZip to ZIP64).
 *
 * Robust part (SecureDog final pass): ExcelJS never parses the upload itself. `sanitizeXlsx`
 * rebuilds a clean archive from exactly the entries the guard inflated, so the guard and JSZip
 * can never disagree about what gets inflated.
 */
import 'server-only'
import zlib from 'node:zlib'
import JSZip from 'jszip'

export const XLSX_MAX_ENTRIES = 1000
/** Real total of all inflated entries. ExcelJS's in-memory model is several times this. */
export const XLSX_MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024

const BAD = 'El archivo Excel no es válido o es demasiado grande al descomprimir.'

type Entry = { name: string; data: Uint8Array }

/** An error message, or null when the archive passes the guard. */
export function xlsxArchiveProblem(buf: Uint8Array): string | null {
  try {
    return inspect(buf, [])
  } catch {
    return BAD
  }
}

/**
 * The only thing to hand to ExcelJS: a clean archive rebuilt from the inspected, already-inflated
 * entries (≤ 40 MB in total), or the refusal message.
 */
export async function sanitizeXlsx(buf: Uint8Array): Promise<{ ok: true; clean: Buffer } | { ok: false; error: string }> {
  const entries: Entry[] = []
  let problem: string | null
  try {
    problem = inspect(buf, [], entries)
  } catch {
    problem = BAD
  }
  if (problem) return { ok: false, error: problem }
  const zip = new JSZip()
  for (const e of entries) {
    if (e.name.endsWith('/')) zip.folder(e.name)
    else zip.file(e.name, e.data, { binary: true })
  }
  const clean = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  return { ok: true, clean }
}

/** Entry names the guard inspected (null when refused). For differential tests against JSZip. */
export function xlsxInspectedEntryNames(buf: Uint8Array): string[] | null {
  const names: string[] = []
  try {
    return inspect(buf, names) === null ? names : null
  } catch {
    return null
  }
}

function inspect(buf: Uint8Array, names: string[], out?: Entry[]): string | null {
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
  // Single-disk archive only: any other value here switches JSZip into its ZIP64 path, where it
  // reads a directory located elsewhere in the file (SecureDog final pass).
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) return BAD
  if (view.getUint16(eocd + 8, true) !== entries) return BAD
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
    names.push(new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)))
    if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) return BAD

    if (local + 30 > cdOffset || view.getUint32(local, true) !== 0x04034b50) return BAD
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const dataEnd = dataStart + compressed
    if (dataEnd > cdOffset) return BAD

    const budget = XLSX_MAX_UNCOMPRESSED_BYTES - total
    let data: Uint8Array
    if (method === 0) {
      if (compressed > budget) return BAD
      data = buf.subarray(dataStart, dataEnd)
    } else if (method === 8) {
      try {
        // maxOutputLength throws once the budget is exceeded: memory stays bounded.
        data = zlib.inflateRawSync(buf.subarray(dataStart, dataEnd), { maxOutputLength: Math.max(1, budget + 1) })
      } catch {
        return BAD
      }
    } else {
      return BAD
    }
    const real = data.length
    if (out) out.push({ name: names[names.length - 1], data })
    if (real !== declared) return BAD
    total += real
    if (total > XLSX_MAX_UNCOMPRESSED_BYTES) return BAD
    p += 46 + nameLen + extraLen + commentLen
  }
  // Every byte of the directory was an entry we inspected: nothing hidden after the last one.
  if (p !== eocd) return BAD
  return null
}

/**
 * At most N xlsx parses at once per process (each can hold ~40 MB of XML plus ExcelJS's model),
 * whatever the number of businesses. Returns a release function, or null when busy.
 */
const MAX_CONCURRENT_PARSES = 2
let activeParses = 0

export function acquireXlsxParseSlot(): (() => void) | null {
  if (activeParses >= MAX_CONCURRENT_PARSES) return null
  activeParses++
  let released = false
  return () => {
    if (!released) {
      released = true
      activeParses--
    }
  }
}
