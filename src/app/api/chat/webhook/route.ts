import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getVerifyTokens() {
  const raw = [
    process.env.INSTAGRAM_VERIFY_TOKEN,
    process.env.WHATSAPP_WEBHOOK_SECRET,
    process.env.META_APP_SECRET,
  ].filter(Boolean) as string[]
  return raw.map((t) => t.trim()).filter(Boolean)
}

function maskToken(token?: string | null) {
  if (!token) return 'null'
  const t = String(token)
  if (t.length <= 6) return '*'.repeat(t.length)
  return `${t.slice(0,2)}***${t.slice(-2)}`
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const challenge = url.searchParams.get('hub.challenge')
  const verifyToken = (url.searchParams.get('hub.verify_token') || '').trim()

  try {
    const headers = Object.fromEntries(request.headers)
    const allowed = getVerifyTokens()
    console.log('[chat/webhook][GET] Verification attempt', {
      url: request.url,
      mode,
      hasChallenge: Boolean(challenge),
      verifyTokenProvided: maskToken(verifyToken || ''),
      verifyTokenRaw: verifyToken || 'null',
      allowedTokens: allowed.map(maskToken),
      allowedTokensRaw: allowed,
      headers: {
        host: headers['host'],
        'user-agent': headers['user-agent'],
        'x-forwarded-for': headers['x-forwarded-for'],
      },
    })
  } catch {}

  if (mode === 'subscribe' && verifyToken && challenge) {
    const allowed = getVerifyTokens()
    if (allowed.includes(verifyToken)) {
      console.log('[chat/webhook][GET] Verification success; echoing challenge')
      return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    console.warn('[chat/webhook][GET] Verification failed: token mismatch')
    return NextResponse.json({ error: 'Invalid verify token' }, { status: 403 })
  }
  return NextResponse.json({ status: 'ok' })
}

export async function POST(request: NextRequest) {
  try {
    const db = prisma as any
    const raw = await request.text()
    const contentType = request.headers.get('content-type') || 'application/json'
    let payload: any = {}
    try {
      payload = contentType.includes('application/json') ? JSON.parse(raw || '{}') : {}
    } catch {}

    const providedSecret = request.headers.get('x-webhook-secret') || ''
    const signature = request.headers.get('x-hub-signature-256') || ''
    const allowed = getVerifyTokens()
    if (allowed.length && !allowed.includes(providedSecret)) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const headerPlatform = (request.headers.get('x-platform') || '').toLowerCase()
    const platform = String(payload.platform || headerPlatform || '').toLowerCase()
    const to = payload.to || payload.recipient || payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null
    const text = payload.text || payload.message || payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || ''
    const timestamp = payload.timestamp || Date.now()
    try {
      console.log('[chat/webhook][POST] Incoming event', {
        contentType,
        signaturePresent: Boolean(signature),
        providedSecretPresent: Boolean(providedSecret),
        platform,
        to,
        textPreview: String(text || '').slice(0, 120),
        payloadKeys: payload ? Object.keys(payload) : [],
        rawPreview: raw.slice(0, 300),
      })
    } catch {}

    let account = null as null | { id: string; tenantId: string }
    if (platform && to) {
      const found = await db.socialAccount.findFirst({ where: { platform, accountId: String(to) } })
      if (found) account = { id: found.id, tenantId: found.tenantId }
    }

    if (!account) {
      console.warn('[chat/webhook][POST] No matching SocialAccount found for event; skipping DB write', { platform, to })
      return NextResponse.json({ ok: true, stored: false })
    }

    const sentAt = new Date(Number.isFinite(Number(timestamp)) ? Number(timestamp) * (String(timestamp).length > 10 ? 1 : 1000) : Date.now())

    await db.chatMessage.create({
      data: {
        tenantId: account.tenantId,
        socialAccountId: account.id,
        direction: 'inbound',
        content: String(text || ''),
        metadata: { raw: payload },
        sentAt,
        receivedAt: new Date(),
      }
    })

    await db.webhookLog.create({
      data: {
        tenantId: account.tenantId,
        level: 'info',
        message: `chat-webhook:${platform}`,
        data: JSON.stringify({ headers: Object.fromEntries(request.headers), payload }),
        source: 'chat-webhook'
      }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
