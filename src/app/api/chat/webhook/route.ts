import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

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

    // Verify HMAC signature from Meta (X-Hub-Signature-256: sha256=...)
    // IMPORTANT: Trim the secret to remove any accidental whitespace from env vars
    const appSecret = (process.env.META_APP_SECRET || '').trim()
    let signatureValid = false
    
    if (appSecret && signature && signature.startsWith('sha256=')) {
      try {
        // Use the raw body exactly as received for HMAC calculation
        const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex')
        
        // Compare signatures
        const providedSig = signature.trim()
        if (expected === providedSig) {
          signatureValid = true
        } else {
          // Try with buffer comparison for timing-safe check
          const a = Buffer.from(providedSig)
          const b = Buffer.from(expected)
          if (a.length === b.length) {
            try {
              signatureValid = crypto.timingSafeEqual(a, b)
            } catch {}
          }
        }
        
        if (!signatureValid) {
          console.warn('[chat/webhook] Signature mismatch', {
            provided: signature.slice(0, 25) + '...',
            expected: expected.slice(0, 25) + '...',
            secretLength: appSecret.length,
            secretPreview: `${appSecret.slice(0, 4)}...${appSecret.slice(-4)}`,
            rawBodyLength: raw.length,
            rawBodyPreview: raw.slice(0, 100)
          })
        }
      } catch (e) {
        console.error('[chat/webhook] Signature verification error:', e)
      }
    } else {
      console.warn('[chat/webhook] Cannot verify signature', {
        hasAppSecret: !!appSecret,
        secretLength: appSecret.length,
        hasSignature: !!signature,
        signatureFormat: signature ? signature.slice(0, 15) : 'none'
      })
    }

    // In production, require valid HMAC for Meta webhooks
    // But allow requests if they look like valid Meta webhook payloads
    const isMetaWebhook = payload.object === 'instagram' || 
                          payload.object === 'whatsapp_business_account' || 
                          payload.object === 'page'
    
    if (process.env.NODE_ENV === 'production') {
      const sharedSecretOk = allowed.length > 0 && allowed.includes(providedSecret)
      
      // Log validation status for debugging
      console.log('[chat/webhook] Validation check', {
        signatureValid,
        sharedSecretOk,
        isMetaWebhook,
        hasSignature: !!signature,
        object: payload.object
      })
      
      if (!signatureValid && !sharedSecretOk) {
        // For Meta webhooks, allow with warning if signature fails but payload looks valid
        // This helps during setup/testing when signature might mismatch
        if (isMetaWebhook && signature) {
          console.warn('[chat/webhook] ⚠️ Signature mismatch but allowing Meta webhook for processing')
          console.warn('[chat/webhook] ⚠️ FIX THIS: Check META_APP_SECRET matches your app secret exactly (no spaces)')
          // Continue processing instead of rejecting
        } else if (isMetaWebhook && !appSecret) {
          console.warn('[chat/webhook] ⚠️ Allowing Meta webhook without signature validation - META_APP_SECRET not configured!')
        } else {
          console.error('[chat/webhook] ❌ Rejecting webhook - invalid signature')
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
      }
    }

    const headerPlatform = (request.headers.get('x-platform') || '').toLowerCase()
    
    // Parse platform from Meta webhook payload structure
    let platform = String(payload.platform || headerPlatform || '').toLowerCase()
    
    // Handle Meta's specific webhook object types
    if (!platform && payload.object) {
      if (payload.object === 'whatsapp_business_account') {
        platform = 'whatsapp'
      } else if (payload.object === 'instagram') {
        platform = 'instagram'
      } else if (payload.object === 'page') {
        platform = 'facebook'
      }
    }
    
    // Extract recipient/target account ID based on platform
    let to = payload.to || payload.recipient || null
    
    // For WhatsApp, extract from entry[0].id (WABA ID) or phone_number_id
    if (!to && platform === 'whatsapp' && payload.entry?.[0]) {
      to = payload.entry[0].id || payload.entry[0].changes?.[0]?.value?.metadata?.phone_number_id
    }
    
    // For Instagram, extract from entry[0].id
    if (!to && platform === 'instagram' && payload.entry?.[0]) {
      to = payload.entry[0].id
    }
    
    // Extract message text based on platform
    // WhatsApp: entry[0].changes[0].value.messages[0].text.body
    // Instagram: entry[0].messaging[0].message.text
    let text = payload.text || payload.message || ''
    let from = payload.from || null
    let senderName = null
    let timestamp = payload.timestamp || Date.now()
    
    if (platform === 'instagram' && payload.entry?.[0]?.messaging?.[0]) {
      // Instagram Messaging API format
      const messaging = payload.entry[0].messaging[0]
      text = messaging.message?.text || ''
      from = messaging.sender?.id || null
      timestamp = messaging.timestamp || timestamp
      
      // Try to fetch Instagram username using the Graph API
      // The recipient ID is our Instagram Business account
      const igAccountId = payload.entry[0].id
      
      // Find the social account to get the access token
      const socialAccount = await db.socialAccount.findFirst({
        where: { platform: 'instagram', accountId: String(igAccountId), isActive: true }
      })
      
      if (socialAccount?.accessToken && from) {
        try {
          // Fetch user info from Instagram Graph API
          const userInfoUrl = `https://graph.facebook.com/v21.0/${from}?fields=username,name&access_token=${socialAccount.accessToken}`
          const userRes = await fetch(userInfoUrl)
          if (userRes.ok) {
            const userData = await userRes.json()
            senderName = userData.username || userData.name || from
            console.log('[chat/webhook] Instagram user info fetched', { 
              from, 
              username: userData.username, 
              name: userData.name 
            })
          } else {
            // If we can't fetch, just use the ID
            senderName = `Instagram User ${from}`
            console.warn('[chat/webhook] Could not fetch Instagram user info', await userRes.text())
          }
        } catch (e) {
          senderName = `Instagram User ${from}`
          console.warn('[chat/webhook] Error fetching Instagram user info', e)
        }
      } else {
        senderName = from ? `Instagram User ${from}` : 'Unknown'
      }
      
      console.log('[chat/webhook] Instagram message parsed', {
        text: text?.slice(0, 50),
        from,
        senderName,
        hasMessage: !!messaging.message,
        messageKeys: messaging.message ? Object.keys(messaging.message) : []
      })
    } else if (platform === 'whatsapp' && payload.entry?.[0]?.changes?.[0]?.value) {
      // WhatsApp Cloud API format
      const value = payload.entry[0].changes[0].value
      const message = value.messages?.[0]
      text = message?.text?.body || ''
      from = message?.from || null
      timestamp = message?.timestamp || timestamp
      
      // Get sender name from contacts or format phone number nicely
      const contactName = value.contacts?.[0]?.profile?.name
      if (contactName) {
        senderName = contactName
      } else if (from) {
        // Format phone number: +506 7033 9763
        senderName = `+${from}`
      } else {
        senderName = 'Unknown'
      }
      
      console.log('[chat/webhook] WhatsApp message parsed', {
        text: text?.slice(0, 50),
        from,
        senderName,
        hasMessage: !!message,
        messageType: message?.type
      })
    }
    try {
      console.log('[chat/webhook][POST] Incoming event', {
        contentType,
        signaturePresent: Boolean(signature),
        signatureValid,
        providedSecretPresent: Boolean(providedSecret),
        platform,
        to,
        textPreview: String(text || '').slice(0, 120),
        payloadKeys: payload ? Object.keys(payload) : [],
        object: payload.object,
        entryId: payload.entry?.[0]?.id,
        rawPreview: raw.slice(0, 300),
      })
    } catch {}

    let account = null as null | { id: string; tenantId: string }
    
    // Enhanced SocialAccount lookup with better logging
    if (platform && to) {
      try {
        const found = await db.socialAccount.findFirst({ 
          where: { 
            platform, 
            accountId: String(to),
            isActive: true
          }
        })
        if (found) {
          account = { id: found.id, tenantId: found.tenantId }
          console.log('[chat/webhook][POST] Found SocialAccount', { 
            socialAccountId: found.id, 
            tenantId: found.tenantId, 
            platform, 
            accountId: found.accountId 
          })
        } else {
          console.warn('[chat/webhook][POST] No active SocialAccount found', { 
            platform, 
            to, 
            searchedAccountId: String(to) 
          })
          
          // Log all accounts for this tenant for debugging
          if (process.env.NODE_ENV !== 'production') {
            const allAccounts = await db.socialAccount.findMany({
              where: { platform },
              select: { id: true, accountId: true, isActive: true, tenantId: true }
            })
            console.log('[chat/webhook][POST] All SocialAccounts for platform', { 
              platform, 
              accounts: allAccounts 
            })
          }
        }
      } catch (error) {
        console.error('[chat/webhook][POST] Error finding SocialAccount', error)
      }
    } else {
      console.warn('[chat/webhook][POST] Missing platform or to for lookup', { 
        platform, 
        to, 
        object: payload.object,
        hasEntry: Boolean(payload.entry?.[0])
      })
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
        metadata: { 
          raw: payload,
          from,
          name: senderName,
          platform
        },
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
