import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  getMetaWebhookVerifyTokens,
  maskMetaSecret,
  verifyMetaWebhookSignature,
} from '@/lib/meta-api'
import { parseMetaChatPayload, type ParsedMetaChatMessage } from '@/lib/meta-chat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getHeaderSnapshot(request: NextRequest) {
  return {
    host: request.headers.get('host'),
    userAgent: request.headers.get('user-agent'),
    forwardedFor: request.headers.get('x-forwarded-for'),
    signaturePresent: Boolean(request.headers.get('x-hub-signature-256')),
  }
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode')
  const challenge = request.nextUrl.searchParams.get('hub.challenge')
  const verifyToken = (request.nextUrl.searchParams.get('hub.verify_token') || '').trim()
  const allowedTokens = getMetaWebhookVerifyTokens()

  console.log('[chat/webhook][GET] Verification attempt', {
    mode,
    hasChallenge: Boolean(challenge),
    verifyTokenProvided: maskMetaSecret(verifyToken),
    allowedTokens: allowedTokens.map(maskMetaSecret),
    headers: getHeaderSnapshot(request),
  })

  if (mode !== 'subscribe' || !challenge) {
    return NextResponse.json({ status: 'ok' })
  }

  if (allowedTokens.length === 0) {
    console.error('[chat/webhook][GET] No Meta webhook verify token configured')
    return NextResponse.json({ error: 'Webhook verify token not configured' }, { status: 500 })
  }

  if (!verifyToken || !allowedTokens.includes(verifyToken)) {
    console.warn('[chat/webhook][GET] Verification failed: token mismatch')
    return NextResponse.json({ error: 'Invalid verify token' }, { status: 403 })
  }

  console.log('[chat/webhook][GET] Verification success')
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

async function alreadyStored(db: any, accountId: string, providerMessageId?: string) {
  if (!providerMessageId) return false

  const existing = await db.chatMessage.findFirst({
    where: {
      socialAccountId: accountId,
      direction: 'inbound',
      metadata: {
        path: ['providerMessageId'],
        equals: providerMessageId,
      },
    },
    select: { id: true },
  })

  return Boolean(existing)
}

async function storeMessage(db: any, event: ParsedMetaChatMessage) {
  const account = await db.socialAccount.findFirst({
    where: {
      platform: event.platform,
      accountId: event.accountId,
      isActive: true,
    },
    select: { id: true, tenantId: true },
  })

  if (!account) {
    console.warn('[chat/webhook][POST] No active SocialAccount found for Meta event', {
      platform: event.platform,
      accountId: event.accountId,
      senderId: event.senderId,
      providerMessageId: event.providerMessageId,
    })
    return { stored: false, reason: 'account_not_found' }
  }

  if (await alreadyStored(db, account.id, event.providerMessageId)) {
    console.log('[chat/webhook][POST] Duplicate Meta message skipped', {
      socialAccountId: account.id,
      providerMessageId: event.providerMessageId,
    })
    return { stored: false, reason: 'duplicate' }
  }

  await db.chatMessage.create({
    data: {
      tenantId: account.tenantId,
      socialAccountId: account.id,
      direction: 'inbound',
      content: event.content,
      metadata: {
        ...event.metadata,
        from: event.senderId,
        name: event.senderName,
        platform: event.platform,
        providerMessageId: event.providerMessageId,
      },
      sentAt: event.sentAt,
      receivedAt: new Date(),
    },
  })

  await db.webhookLog.create({
    data: {
      tenantId: account.tenantId,
      level: 'info',
      message: `chat-webhook:${event.platform}`,
      source: 'chat-webhook',
      data: JSON.stringify({
        platform: event.platform,
        accountId: event.accountId,
        senderId: event.senderId,
        providerMessageId: event.providerMessageId,
        messageType: event.messageType,
      }),
    },
  })

  return { stored: true }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    const signatureValid = verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'))

    if (process.env.NODE_ENV === 'production' && !signatureValid) {
      console.error('[chat/webhook][POST] Rejecting webhook with invalid Meta signature', {
        headers: getHeaderSnapshot(request),
        hasAppSecret: Boolean(process.env.META_APP_SECRET),
      })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let payload: any
    try {
      payload = JSON.parse(raw || '{}')
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = parseMetaChatPayload(payload)
    console.log('[chat/webhook][POST] Incoming Meta event', {
      object: payload?.object,
      signatureValid,
      parsedMessages: parsed.messages.length,
      ignoredReasons: parsed.ignoredReasons,
      entryCount: payload?.entry?.length || 0,
    })

    if (parsed.messages.length === 0) {
      return NextResponse.json({
        ok: true,
        stored: 0,
        ignoredReasons: parsed.ignoredReasons,
      })
    }

    const db = prisma as any
    const results = []
    for (const event of parsed.messages) {
      results.push(await storeMessage(db, event))
    }

    const stored = results.filter((result) => result.stored).length
    return NextResponse.json({
      ok: true,
      stored,
      skipped: results.length - stored,
      ignoredReasons: parsed.ignoredReasons,
    })
  } catch (error) {
    console.error('[chat/webhook][POST] Internal error', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
