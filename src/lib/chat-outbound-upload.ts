/**
 * Browser side of an inbox file send (Rafael 2026-10-22: "sending an image cripples the site").
 * Photos are shrunk before upload (WhatsApp / Instagram recompress anyway) and uploads report progress,
 * so the bubble shows how far it is while the composer stays free.
 */

/** Longest side of a photo after downscale. */
export const OUTBOUND_IMAGE_MAX_SIDE = 1600
/** Photos already at most this size and within the max side are sent as they are. */
export const OUTBOUND_IMAGE_KEEP_BYTES = 1024 * 1024
const OUTBOUND_IMAGE_QUALITY = 0.85
// WhatsApp images are JPEG / PNG only (webp is stickers): every shrunk photo goes out as JPEG.
const DOWNSCALE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type DownscalePlan = { resize: false } | { resize: true; width: number; height: number }

/** Pure decision: shrink only real photos that are too big in pixels or bytes. */
export function planImageDownscale(
  input: { type: string; size: number; width: number; height: number },
  maxSide = OUTBOUND_IMAGE_MAX_SIDE,
): DownscalePlan {
  if (!DOWNSCALE_MIMES.has(input.type.toLowerCase())) return { resize: false }
  const { width, height } = input
  if (!(width > 0 && height > 0)) return { resize: false }
  const longest = Math.max(width, height)
  if (longest <= maxSide && input.size <= OUTBOUND_IMAGE_KEEP_BYTES && input.type !== 'image/webp') return { resize: false }
  const scale = longest > maxSide ? maxSide / longest : 1
  return { resize: true, width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function jpegFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'foto'
  return `${base}.jpg`
}

/** Shrinks a photo in the browser; any failure (HEIC, old browser, huge canvas) sends the original. */
export async function downscaleImageForSend(file: File): Promise<File> {
  if (typeof window === 'undefined' || !DOWNSCALE_MIMES.has(file.type.toLowerCase())) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    try {
      const plan = planImageDownscale({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height })
      if (!plan.resize) return file
      const canvas = document.createElement('canvas')
      canvas.width = plan.width
      canvas.height = plan.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      // Transparent PNGs become JPEG: white behind them, never black.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, plan.width, plan.height)
      ctx.drawImage(bitmap, 0, 0, plan.width, plan.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', OUTBOUND_IMAGE_QUALITY))
      if (!blob || (blob.size >= file.size && file.type !== 'image/webp')) return file
      return new File([blob], jpegFilename(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
    } finally {
      bitmap.close?.()
    }
  } catch {
    return file
  }
}

/**
 * multipart POST with upload progress (fetch has none). Resolves a Response so callers keep using
 * parseApiJson; network errors reject like fetch does.
 */
export function postFormWithProgress(
  url: string,
  body: FormData,
  onProgress: (fraction: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total))
    }
    xhr.onload = () => {
      onProgress(1)
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status || 500,
          headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' },
        }),
      )
    }
    xhr.onerror = () => reject(new Error('No se pudo subir el archivo (sin conexión).'))
    xhr.ontimeout = () => reject(new Error('Tiempo de espera agotado al subir el archivo.'))
    xhr.send(body)
  })
}

/** Message type the server will store for this file (for the pending bubble). */
export function outboundKindForMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}
