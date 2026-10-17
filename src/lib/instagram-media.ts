import 'server-only'
/**
 * Instagram (Facebook Page login) photo sends: upload the bytes to the Page's message_attachments (platform=instagram)
 * → attachment_id, then send it to the customer. Same host / token / appsecret proof as the Instagram text send
 * (api/chat/send). Never a public URL of our private files: Meta gets the bytes, never a link to them.
 * Instagram only takes JPG / PNG photos up to 8 MB here (video / audio / documents stay WhatsApp-only).
 */
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'

export const INSTAGRAM_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const INSTAGRAM_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png'])
export const INSTAGRAM_MEDIA_ONLY_PHOTOS = 'Por Instagram solo se pueden enviar fotos JPG o PNG (máx. 8 MB).'

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return text.trim() ? JSON.parse(text) : {}
  } catch {
    return { error: { message: 'Respuesta no JSON de Meta' } }
  }
}

/** Instagram send path: the Page's /messages (or me/messages for a legacy Page token without a stored page id). */
export function instagramPath(pageId: string | null | undefined, edge: 'messages' | 'message_attachments'): string {
  return pageId ? `${encodeURIComponent(pageId)}/${edge}` : `me/${edge}`
}

/** Upload one photo; returns Meta's reusable attachment_id, or the error Meta gave. */
export async function uploadInstagramImage(opts: {
  pageId: string | null | undefined
  accessToken: string
  bytes: Uint8Array
  mime: string
  timeoutMs: number
}): Promise<{ ok: true; attachmentId: string } | { ok: false; error: string; data?: unknown }> {
  if (!INSTAGRAM_IMAGE_MIMES.has(opts.mime)) return { ok: false, error: INSTAGRAM_MEDIA_ONLY_PHOTOS }
  if (opts.bytes.length === 0 || opts.bytes.length > INSTAGRAM_IMAGE_MAX_BYTES) return { ok: false, error: INSTAGRAM_MEDIA_ONLY_PHOTOS }
  const form = new FormData()
  form.append('platform', 'instagram')
  form.append('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: true } } }))
  form.append('filedata', new Blob([new Uint8Array(opts.bytes)], { type: opts.mime }), opts.mime === 'image/png' ? 'imagen.png' : 'imagen.jpg')
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(instagramPath(opts.pageId, 'message_attachments')), opts.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs),
  })
  const data = await readJson(res)
  const attachmentId = data?.attachment_id != null ? String(data.attachment_id) : ''
  if (!res.ok || !attachmentId) return { ok: false, error: data?.error?.message || 'Instagram no aceptó la foto.', data }
  return { ok: true, attachmentId }
}

/**
 * Send an uploaded photo (RESPONSE, inside the 24 h window). Meta's docs show both `image` and `MEDIA_SHARE` for an
 * attachment_id; `image` first, and only when Meta REJECTS it (4xx, nothing was sent) one try with `MEDIA_SHARE`.
 */
export async function sendInstagramImage(opts: {
  pageId: string | null | undefined
  accessToken: string
  recipient: string
  attachmentId: string
  timeoutMs: number
}): Promise<{ ok: true; providerMessageId: string | null; data: unknown } | { ok: false; error: string; data?: unknown }> {
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(instagramPath(opts.pageId, 'messages')), opts.accessToken)
  let last: { error: string; data?: unknown } = { error: 'Falló el envío por Instagram' }
  for (const type of ['image', 'MEDIA_SHARE']) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: { id: opts.recipient },
        message: { attachment: { type, payload: { attachment_id: opts.attachmentId } } },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
    const data = await readJson(res)
    if (res.ok) {
      const id = data?.message_id || data?.messages?.[0]?.id
      return { ok: true, providerMessageId: id ? String(id) : null, data }
    }
    last = { error: data?.error?.message || 'Falló el envío por Instagram', data }
    // Only a clean rejection of the request is retried with the other type; anything else may have gone out.
    if (res.status < 400 || res.status >= 500) break
  }
  return { ok: false, ...last }
}

/** Plain Instagram text (the caption after a photo — Instagram photos carry no caption). */
export async function sendInstagramText(opts: {
  pageId: string | null | undefined
  accessToken: string
  recipient: string
  text: string
  timeoutMs: number
}): Promise<boolean> {
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(instagramPath(opts.pageId, 'messages')), opts.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_type: 'RESPONSE', recipient: { id: opts.recipient }, message: { text: opts.text } }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  })
  return res.ok
}
