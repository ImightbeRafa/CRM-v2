import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  parseMetaChatPayload,
  type ParsedMetaChatMessage,
  type ParsedMetaChatReceipt,
} from '@/lib/meta-chat'
import {
  describeMetaSignatureHeader,
  getMetaWebhookVerifyTokens,
  maskMetaSecret,
  verifyMetaWebhookSignature,
} from '@/lib/meta-api'
import { getPageIdFromMetaChatMetadata } from '@/lib/social-account-meta'
import { resolveWebhookSocialAccount } from '@/lib/chat-webhook-account'
import { chatWebhookInvalidSignatureRateLimit } from '@/lib/rate-limit'
import { maybeRunSoftAiAfterInbound } from '@/lib/soft-ai/inbound-hook'
import {
  applyDeliveryStatusUpdate,
  applyPeerReadWatermark,
  dualWriteChatMessage,
} from '@/lib/chat-conversation-write'

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
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function receiptAsResolveEvent(receipt: ParsedMetaChatReceipt): ParsedMetaChatMessage {
  return {
    platform: receipt.platform,
    accountId: receipt.accountId,
    senderId: receipt.peerId || 'receipt',
    content: '',
    messageType: 'receipt',
    sentAt: receipt.statusAt,
    direction: 'outbound',
    suppressSoftAi: true,
    metadata: {},
    providerMessageId: receipt.providerMessageId,
  }
}

async function storeMessage(event: ParsedMetaChatMessage) {
  const resolved = await resolveWebhookSocialAccount(prisma as any, event)

  if (!resolved.ok) {
    console.warn('[chat/webhook][POST] No resolvable SocialAccount for Meta event', {
      platform: event.platform,
      accountId: event.accountId,
      pageId: getPageIdFromMetaChatMetadata(event.metadata),
      webhookObject: event.metadata?.webhookObject,
      senderId: event.senderId,
      providerMessageId: event.providerMessageId,
      reason: resolved.reason,
    })
    return { stored: false as const, reason: resolved.reason }
  }

  const account = resolved.account
  const direction = event.direction || 'inbound'

  const result = await dualWriteChatMessage({
    tenantId: account.tenantId,
    socialAccountId: account.id,
    direction,
    content: event.content,
    sentAt: event.sentAt,
    receivedAt: direction === 'inbound' ? new Date() : null,
    peerId: event.senderId,
    peerName: event.senderName || null,
    providerMessageId: event.providerMessageId || null,
    messageType: event.messageType || null,
    deliveryStatus: direction === 'inbound' ? 'received' : 'sent',
    platform: event.platform,
    metadata: {
      ...event.metadata,
      from: direction === 'inbound' ? event.senderId : undefined,
      to: direction === 'outbound' ? event.senderId : undefined,
      name: event.senderName,
      platform: event.platform,
      providerMessageId: event.providerMessageId,
      direction,
    },
    suppressSoftAi: Boolean(event.suppressSoftAi) || direction !== 'inbound',
  })

  if (!result.ok) {
    console.warn('[chat/webhook][POST] Dual-write skipped/failed', {
      socialAccountId: account.id,
      providerMessageId: event.providerMessageId,
      reason: result.reason,
      error: 'error' in result ? result.error : undefined,
    })
    return { stored: false as const, reason: result.reason }
  }

  if (result.duplicate) {
    console.log('[chat/webhook][POST] Duplicate Meta message skipped', {
      socialAccountId: account.id,
      providerMessageId: event.providerMessageId,
      messageId: result.messageId,
    })
    return { stored: false as const, reason: 'duplicate' as const }
  }

  await (prisma as any).webhookLog.create({
    data: {
      tenantId: account.tenantId,
      level: 'info',
      message: `chat-webhook:${event.platform}`,
      source: 'chat-webhook',
      data: JSON.stringify({
        platform: event.platform,
        accountId: event.accountId,
        pageId: getPageIdFromMetaChatMetadata(event.metadata),
        senderId: event.senderId,
        providerMessageId: event.providerMessageId,
        messageType: event.messageType,
        direction,
        suppressSoftAi: event.suppressSoftAi,
        conversationId: result.conversationId,
        messageId: result.messageId,
      }),
    },
  })

  return {
    stored: true as const,
    tenantId: result.tenantId,
    socialAccountId: result.socialAccountId,
    senderId: result.peerId,
    senderName: result.peerName,
    platform: event.platform as string,
    content: result.content,
    suppressSoftAi: result.suppressSoftAi,
    conversationId: result.conversationId,
    messageId: result.messageId,
  }
}

async function applyReceipt(receipt: ParsedMetaChatReceipt) {
  const resolved = await resolveWebhookSocialAccount(
    prisma as any,
    receiptAsResolveEvent(receipt),
  )
  if (!resolved.ok) {
    return { updated: false, reason: resolved.reason }
  }

  if (receipt.kind === 'instagram_read' && !receipt.providerMessageId && receipt.peerId) {
    const count = await applyPeerReadWatermark({
      socialAccountId: resolved.account.id,
      peerId: receipt.peerId,
      readAt: receipt.statusAt,
    })
    return { updated: count > 0, reason: count > 0 ? undefined : 'no_rows', count }
  }

  if (!receipt.providerMessageId) {
    return { updated: false, reason: 'missing_provider_id' }
  }

  return applyDeliveryStatusUpdate({
    socialAccountId: resolved.account.id,
    providerMessageId: receipt.providerMessageId,
    status: receipt.status,
    statusAt: receipt.statusAt,
    errorCode: receipt.errorCode,
  })
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  try {
    // HMAC first — never IP-throttle signature-valid Meta fan-in.
    const raw = await request.text()
    const signatureHeader = request.headers.get('x-hub-signature-256')
    const signatureResult = verifyMetaWebhookSignature(raw, signatureHeader)

    if (!signatureResult.valid) {
      const rateLimited = await chatWebhookInvalidSignatureRateLimit(request)
      if (rateLimited instanceof Response) {
        return rateLimited
      }

      if (process.env.NODE_ENV === 'production') {
        const signatureDiag = describeMetaSignatureHeader(signatureHeader)
        console.warn('[chat/webhook][POST] Invalid signature', {
          signaturePresent: signatureDiag.signaturePresent,
          signaturePrefix: signatureDiag.signaturePrefix,
          bodyLen: raw.length,
          contentType: request.headers.get('content-type'),
          host: request.headers.get('host'),
          triedMeta: signatureResult.triedMeta,
          triedWhatsApp: signatureResult.triedWhatsApp,
          triedInstagram: signatureResult.triedInstagram,
          durationMs: Date.now() - startedAt,
        })
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    if (signatureResult.valid && signatureResult.matchedSecret === 'instagram') {
      console.info('[chat/webhook][POST] Signature matched INSTAGRAM_APP_SECRET fallback', {
        matchedSecret: 'instagram',
      })
    }

    if (signatureResult.valid && signatureResult.matchedSecret === 'whatsapp') {
      console.info('[chat/webhook][POST] Signature matched META_WA_APP_SECRET', {
        matchedSecret: 'whatsapp',
      })
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
      signatureValid: signatureResult.valid,
      matchedSecret: signatureResult.matchedSecret,
      parsedMessages: parsed.messages.length,
      receipts: parsed.receipts.length,
      ignoredReasons: parsed.ignoredReasons,
      accountEvents: parsed.accountEvents?.length || 0,
      entryCount: payload?.entry?.length || 0,
    })

    const db = prisma as any

    if (parsed.accountEvents?.length) {
      for (const ev of parsed.accountEvents) {
        if (ev.event !== 'PARTNER_REMOVED' || !ev.wabaId) continue
        try {
          const wabaPrefix = `waba:${ev.wabaId}`
          const updated = await db.socialAccount.updateMany({
            where: {
              platform: 'whatsapp',
              isActive: true,
              refreshToken: { startsWith: wabaPrefix },
            },
            data: { isActive: false },
          })
          console.warn('[chat/webhook][POST] PARTNER_REMOVED deactivated WhatsApp accounts', {
            wabaId: ev.wabaId,
            reason: ev.reason,
            initiatedBy: ev.initiatedBy,
            count: updated.count,
          })
        } catch (e) {
          console.warn('[chat/webhook][POST] PARTNER_REMOVED handling failed', e)
        }
      }
    }

    const results = []
    for (const event of parsed.messages) {
      results.push(await storeMessage(event))
    }

    let receiptsUpdated = 0
    for (const receipt of parsed.receipts) {
      const applied = await applyReceipt(receipt)
      if (applied.updated) receiptsUpdated += 1
    }

    const stored = results.filter((result) => result.stored).length

    for (const result of results) {
      if (!result.stored || !('tenantId' in result) || !result.tenantId) continue
      if ('suppressSoftAi' in result && result.suppressSoftAi) continue
      void maybeRunSoftAiAfterInbound({
        tenantId: result.tenantId,
        socialAccountId: result.socialAccountId,
        senderId: result.senderId,
        senderName: result.senderName,
        platform: result.platform,
        content: result.content,
      })
    }

    console.log('[chat/webhook][POST] Done', {
      stored,
      skipped: results.length - stored,
      receiptsUpdated,
      durationMs: Date.now() - startedAt,
      signatureValid: signatureResult.valid,
    })

    return NextResponse.json({
      ok: true,
      stored,
      skipped: results.length - stored,
      receiptsUpdated,
      ignoredReasons: parsed.ignoredReasons,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error('[chat/webhook][POST] Internal error', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
