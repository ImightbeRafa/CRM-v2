import 'server-only'

/**
 * Small previews for chat photos (perf 2026-10-01): the inbox showed every photo at full size.
 * Only JPEG / PNG / WebP are resized (to WebP); GIFs (animation), SVG and anything else are
 * never touched. Any failure falls back to the original bytes.
 */
export const THUMB_WIDTHS = [320, 640] as const
const RESIZABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
/** Decompression-bomb guard (a 40 MP photo is already huge for a chat). */
const MAX_INPUT_PIXELS = 40_000_000

export function parseThumbWidth(raw: string | null): number | null {
  const w = Number(raw)
  return (THUMB_WIDTHS as readonly number[]).includes(w) ? w : null
}

export function isThumbnailable(contentType: string | null | undefined): boolean {
  return RESIZABLE.has(String(contentType || '').split(';')[0].trim().toLowerCase())
}

export async function makeChatThumbnail(bytes: Buffer, width: number): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import('sharp')
    return await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate() // honour EXIF orientation from phone cameras
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer()
  } catch {
    return null
  }
}
