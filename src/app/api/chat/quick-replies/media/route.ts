import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { isTenantFeatureNotDisabled } from '@/lib/feature-flags'
import { logAuditEvent } from '@/lib/auditLogger'
import { CHAT_OUTBOUND_MEDIA_FLAG, classifyOutboundMedia, WA_OUTBOUND_LIMITS } from '@/lib/chat-outbound-media'
import {
  chatBlobUsage,
  deleteChatBlobs,
  describeBlobError,
  putChatMediaToBlob,
  readChatMediaFromBlob,
  safeMediaServeHeaders,
} from '@/lib/chat-media'
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
    // Quota: best effort (a listing failure never blocks an upload; the rate limit still applies).
    try {
      const usage = await chatBlobUsage(quickReplyMediaPrefix(auth.tenantId))
      if (usage.count >= TENANT_MAX_FILES || usage.bytes + media.size > TENANT_MAX_BYTES) {
        return NextResponse.json(
          { error: 'Se alcanzó el espacio para archivos de respuestas rápidas. Quitá archivos que ya no uses.' },
          { status: 413 },
        )
      }
    } catch (error) {
      console.warn('[chat/quick-replies/media] quota check skipped', describeBlobError(error).code)
    }

    const ext = media.filename.split('.').pop() || 'bin'
    const pathname = `${quickReplyMediaPrefix(auth.tenantId)}${Date.now().toString(36)}${randomBytes(6).toString('hex')}.${ext}`
    try {
      await putChatMediaToBlob({
        tenantId: auth.tenantId,
        messageId: 'quick-reply',
        bytes: Buffer.from(bytes),
        contentType: media.mime,
        pathname,
      })
    } catch (error) {
      const why = describeBlobError(error)
      console.error('[chat/quick-replies/media] blob put failed', why.code, why.detail)
      return NextResponse.json({ error: `No se pudo guardar el archivo: ${why.message}`, code: why.code }, { status: 503 })
    }
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
    const why = describeBlobError(error)
    console.error('[chat/quick-replies/media POST]', why.code, why.detail)
    return NextResponse.json({ error: `No se pudo guardar el archivo: ${why.message}`, code: why.code }, { status: 500 })
  }
}

/**
 * ?diag=1 (admins): write / read / delete a tiny test file and report which step fails, with a
 * safe error category (never the token). Used to diagnose the file store from production.
 */
async function storageDiagnostic(tenantId: string) {
  const steps: Array<{ step: string; ok: boolean; code?: string; detail?: string }> = []
  const pathname = `${quickReplyMediaPrefix(tenantId)}diag${randomBytes(6).toString('hex')}.png`
  const run = async (step: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      steps.push({ step, ok: true })
      return true
    } catch (error) {
      const why = describeBlobError(error)
      steps.push({ step, ok: false, code: why.code, detail: why.detail })
      return false
    }
  }
  const tokenPresent = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a50000000049454e44ae426082', 'hex')
  if (await run('put', () => putChatMediaToBlob({ tenantId, messageId: 'diag', bytes: png, contentType: 'image/png', pathname }))) {
    await run('get', () => readChatMediaFromBlob({ pathname }))
    await run('delete', () => deleteChatBlobs([pathname]))
  }
  await run('list', () => chatBlobUsage(quickReplyMediaPrefix(tenantId)))
  return { tokenPresent, steps }
}

/** GET /api/chat/quick-replies/media?path= — thumbnail / preview (this business's files only). */
export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  if (params.get('diag') === '1') {
    const admin = await authenticateAPIWithPermission(request, 'update_config')
    if (!admin.ok) return admin.response
    return NextResponse.json(await storageDiagnostic(admin.tenantId), { headers: { 'Cache-Control': 'no-store' } })
  }
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const path = params.get('path')
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
