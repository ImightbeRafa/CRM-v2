import 'server-only'

/**
 * Small previews for chat photos (perf 2026-10-01): the inbox showed every photo at full size.
 * Only real JPEG / PNG / WebP BYTES are resized (to WebP) — the declared type is not trusted, so an
 * SVG / TIFF / HEIF renamed to .png never reaches those decoders. GIFs (animation) and anything else
 * are never touched. At most 2 previews are built at once (1 vCPU container), each capped at 5 s and
 * 40 MP. Any failure falls back to the original bytes.
 */
export const THUMB_WIDTHS = [320, 640] as const
const RESIZABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
/** Decompression-bomb guard (a 40 MP photo is already huge for a chat). */
const MAX_INPUT_PIXELS = 40_000_000
const MAX_CONCURRENT = 2

export function parseThumbWidth(raw: string | null): number | null {
  const w = Number(raw)
  return (THUMB_WIDTHS as readonly number[]).includes(w) ? w : null
}

export function isThumbnailable(contentType: string | null | undefined): boolean {
  return RESIZABLE.has(String(contentType || '').split(';')[0].trim().toLowerCase())
}

/** The bytes really are JPEG, PNG or WebP (magic numbers), whatever the declared type says. */
export function hasRasterPhotoSignature(bytes: Buffer): boolean {
  if (bytes.length < 12) return false
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const webp = bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  return jpeg || png || webp
}

let running = 0
const waiting: Array<() => void> = []

/**
 * The same 2 decode slots for agent reply images (MEDIA-11): one process-wide limit for every sharp decode.
 * `maxWaiting` refuses (throws IMAGE_BUSY) instead of queueing forever.
 */
export async function withImageDecodeSlot<T>(fn: () => Promise<T>, opts: { maxWaiting?: number } = {}): Promise<T> {
  if (running >= MAX_CONCURRENT && waiting.length >= (opts.maxWaiting ?? 4)) throw new Error('IMAGE_BUSY')
  return withSlot(fn)
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  // A freed slot is handed straight to the next waiter (never decremented in between), so a new
  // caller can't slip in ahead and exceed the limit.
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve))
  else running += 1
  try {
    return await fn()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }
}

export async function makeChatThumbnail(bytes: Buffer, width: number): Promise<Buffer | null> {
  if (!hasRasterPhotoSignature(bytes)) return null
  try {
    return await withSlot(async () => {
      const { default: sharp } = await import('sharp')
      sharp.concurrency(1)
      return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // honour EXIF orientation from phone cameras
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 72 })
        .timeout({ seconds: 5 })
        .toBuffer()
    })
  } catch (error) {
    // Logged once per failure (e.g. sharp missing in the image) — the caller serves the original.
    console.warn('[chat/media] preview skipped:', error instanceof Error ? error.message.slice(0, 120) : 'unknown')
    return null
  }
}
