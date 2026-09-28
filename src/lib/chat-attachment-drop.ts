/**
 * Drag & drop / paste of files into a chat (client-side checks only; the server re-validates
 * the bytes in /api/chat/send-media).
 */

/** Browser cap: uploads stay under the 9.5 MB middleware body copy (see OUTBOUND_UPLOAD_CAP). */
export const DROP_MAX_BYTES = Math.floor(9.5 * 1024 * 1024)

type DataTransferLike = { types?: ArrayLike<string> | readonly string[] | null } | null | undefined

/** True while files (not text / links) are dragged over the page. */
export function hasDraggedFiles(dt: DataTransferLike): boolean {
  const types = dt?.types ? Array.from(dt.types as ArrayLike<string>) : []
  return types.includes('Files')
}

/** Extension allowed by the composer's `accept` list (e.g. ".jpg,.png,.pdf"). */
export function acceptsAttachment(
  file: { name: string; size: number; type?: string },
  accept: string,
): { ok: true } | { ok: false; error: string } {
  const allowed = accept
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const ext = (/\.[a-z0-9]+$/i.exec(file.name || '')?.[0] || '').toLowerCase()
  if (!ext || !allowed.includes(ext)) {
    const isImage = String(file.type || '').startsWith('image/')
    return {
      ok: false,
      error: isImage
        ? 'WhatsApp solo acepta fotos JPG o PNG.'
        : 'Ese tipo de archivo no se puede enviar por WhatsApp.',
    }
  }
  if (file.size > DROP_MAX_BYTES) return { ok: false, error: 'El archivo supera el máximo de 9 MB.' }
  if (file.size === 0) return { ok: false, error: 'El archivo está vacío.' }
  return { ok: true }
}

const EXT_BY_TYPE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' }

/** First pasted file (screenshots come as "image.png"; nameless blobs get a name from their type). */
export function fileFromClipboard(
  data: { files?: ArrayLike<File> | null; items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null } | null,
): File | null {
  if (!data) return null
  const direct = data.files && data.files.length ? data.files[0] : null
  let file = direct
  if (!file && data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file') {
        file = item.getAsFile()
        if (file) break
      }
    }
  }
  if (!file) return null
  if (/\.[a-z0-9]+$/i.test(file.name || '')) return file
  const ext = EXT_BY_TYPE[file.type] || ''
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return new File([file], `captura-${stamp}${ext ? `.${ext}` : ''}`, { type: file.type })
}
