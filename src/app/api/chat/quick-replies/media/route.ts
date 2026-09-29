import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { isTenantFeatureNotDisabled } from '@/lib/feature-flags'
import { logAuditEvent } from '@/lib/auditLogger'
import { CHAT_OUTBOUND_MEDIA_FLAG, classifyOutboundMedia, WA_OUTBOUND_LIMITS } from '@/lib/chat-outbound-media'
import { chatBlobUsage, putChatMediaToBlob, readChatMediaFromBlob, safeMediaServeHeaders } from '@/lib/chat-media'
import { QUICK_REPLY_MAX_COUNT, QUICK_REPLY_MAX_MEDIA, isQuickReplyMediaPath, quickReplyMediaPrefix } from '@/lib/chat-quick-replies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = WA_OUTBOUND_LIMITS.document + 256 * 1024
/** Same set the quick-reply list keeps (photos, PDF, MP4): no Office / macro formats. */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf', 'video/mp4'])
/** Per business: enough for every reply to carry its files, bounded for storage cost. */
const TENANT_MAX_FILES = QUICK_REPLY_MAX_COUNT * QUICK_REPLY_MAX_MEDIA
const TENANT_MAX_BYTES = 500 * 1024 * 1024

const uploadRateLimit = createIdentifierRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  identifier: 'chat-quick-reply-upload',
})

/**
 * POST /api/chat/quick-replies/media (multipart `file`) — a photo / PDF / video for a quick
 * reply. Managers only (same as editing the list). Bytes are classified from their magic
 * numbers and stored privately under `chat-quick-replies/<tenantId>/`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  try {
    if (!(await isTenantFeatureNotDisabled(auth.tenantId, CHAT_OUTBOUND_MEDIA_FLAG))) {
      return NextResponse.json({ error: 'El envío de archivos está desactivado para este negocio.' }, { status: 403 })
    }
    // Per business (not per person): every admin shares one budget.
    const rate = await uploadRateLimit(auth.tenantId)
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
    if (!ALLOWED_MIME.has(media.mime)) {
      return NextResponse.json({ error: 'Adjuntá una foto (JPG/PNG), un PDF o un video MP4.' }, { status: 400 })
    }
    const usage = await chatBlobUsage(quickReplyMediaPrefix(auth.tenantId))
    if (usage.count >= TENANT_MAX_FILES || usage.bytes + media.size > TENANT_MAX_BYTES) {
      return NextResponse.json(
        { error: 'Se alcanzó el espacio para archivos de respuestas rápidas. Quitá archivos que ya no uses.' },
        { status: 413 },
      )
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
    await logAuditEvent({
      action: 'CREATE',
      entityType: 'Tenant',
      entityId: auth.tenantId,
      description: 'Archivo de respuesta rápida subido',
      newValues: { path: pathname, mime: media.mime, size: media.size },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
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
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(blob.bytes.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
