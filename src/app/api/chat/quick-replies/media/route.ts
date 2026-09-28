import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { chatSendRateLimit } from '@/lib/rate-limit'
import { classifyOutboundMedia, WA_OUTBOUND_LIMITS } from '@/lib/chat-outbound-media'
import { putChatMediaToBlob, readChatMediaFromBlob, safeMediaServeHeaders } from '@/lib/chat-media'
import { isQuickReplyMediaPath, quickReplyMediaPrefix } from '@/lib/chat-quick-replies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = WA_OUTBOUND_LIMITS.document + 256 * 1024
const ALLOWED_KINDS = new Set(['image', 'document', 'video'])

/**
 * POST /api/chat/quick-replies/media (multipart `file`) — a photo / PDF / video for a quick
 * reply. Managers only (same as editing the list). Bytes are classified from their magic
 * numbers and stored privately under `chat-quick-replies/<tenantId>/`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  try {
    const rate = await chatSendRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Demasiadas subidas. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const declared = Number(request.headers.get('content-length') || 0)
    if (!declared) return NextResponse.json({ error: 'Falta el tamaño del archivo.' }, { status: 411 })
    if (declared > MAX_BYTES) return NextResponse.json({ error: 'El archivo supera el máximo de 9 MB.' }, { status: 413 })

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const filename = typeof (file as File).name === 'string' ? (file as File).name : 'archivo'
    const media = classifyOutboundMedia({ filename, bytes })
    if (!media.ok) return NextResponse.json({ error: media.error }, { status: 400 })
    if (!ALLOWED_KINDS.has(media.kind)) {
      return NextResponse.json({ error: 'Adjuntá una foto (JPG/PNG), un PDF o un video.' }, { status: 400 })
    }

    const ext = media.filename.split('.').pop() || 'bin'
    const pathname = `${quickReplyMediaPrefix(auth.tenantId)}${Date.now().toString(36)}${randomBytes(6).toString('hex')}.${ext}`
    await putChatMediaToBlob({
      tenantId: auth.tenantId,
      messageId: 'quick-reply',
      bytes: Buffer.from(bytes),
      contentType: media.mime,
      pathname,
    })
    return NextResponse.json({
      success: true,
      media: { path: pathname, mime: media.mime, filename: media.filename, size: media.size },
    })
  } catch (error) {
    console.error('[chat/quick-replies/media POST]', error)
    return NextResponse.json({ error: 'No se pudo guardar el archivo.' }, { status: 500 })
  }
}

/** GET /api/chat/quick-replies/media?path= — thumbnail / preview (this business's files only). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const path = new URL(request.url).searchParams.get('path')
  if (!isQuickReplyMediaPath(path, auth.tenantId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const blob = await readChatMediaFromBlob({ pathname: path })
    const contentType = blob.contentType || 'application/octet-stream'
    return new NextResponse(new Uint8Array(blob.bytes), {
      headers: {
        ...safeMediaServeHeaders(contentType, path.split('/').pop()),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(blob.bytes.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
