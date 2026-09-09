import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'
import { buildMetaGraphUrl, subscribeWhatsAppApp } from '@/lib/meta-api'
import { encodeWhatsAppRefreshToken } from '@/lib/social-account-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/whatsapp/exchange
 * Body: { code?: string, message?: any }
 * - Exchanges Embedded Signup 'code' for a business token
 * - Reads phone_number_id from message event if provided
 * - Stores/updates SocialAccount (platform='whatsapp') and auto-subscribes webhooks
 */
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.tenantId || !token?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = String(token.tenantId)
    const userId = String(token.sub)

    const body = await request.json().catch(() => ({}))
    const code: string | undefined = body?.code
    const accessToken: string | undefined = body?.accessToken
    const message = body?.message

    // phone_number_id may come in the message event payload
    const phoneNumberId: string | null =
      message?.data?.phone_number_id ||
      message?.phone_number_id ||
      null
    const whatsappBusinessAccountId: string | null =
      message?.data?.waba_id ||
      message?.data?.whatsapp_business_account_id ||
      message?.waba_id ||
      message?.whatsapp_business_account_id ||
      null

    // Exchange code for business token (Embedded Signup)
    // OR use direct access token if provided (response_type=token)
    let businessToken: string | null = accessToken || null
    let exchangeError: any = null
    
    if (accessToken) {
      console.log('[wa/exchange] ✅ Access token provided directly (response_type=token)', {
        tokenPrefix: accessToken.substring(0, 20) + '...'
      })
      // Skip code exchange - we already have the token
    } else if (code) {
      const appId = process.env.META_APP_ID || ''
      const appSecret = process.env.META_APP_SECRET || ''
      
      if (!appId || !appSecret) {
        console.error('[wa/exchange] Missing META_APP_ID or META_APP_SECRET')
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
      }
      
      console.log('[wa/exchange] Exchanging Embedded Signup code', {
        codeLength: code.length,
        hasConfigId: Boolean(process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID),
        hasNextAuthUrl: Boolean(process.env.NEXTAUTH_URL),
      })

      // FB JS SDK Embedded Signup typically uses xd_arbiter as redirect_uri.
      const redirectUriCandidates = [
        'https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46',
        'https://staticxx.facebook.com/x/connect/xd_arbiter/',
        process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/config/social` : null,
        process.env.FB_LOGIN_REDIRECT_URI || null,
        null,
      ].filter((uri, index, arr) => arr.indexOf(uri) === index)

      const url = buildMetaGraphUrl('oauth/access_token')

      for (let i = 0; i < redirectUriCandidates.length; i++) {
        const redirectUri = redirectUriCandidates[i]
        try {
          const params = new URLSearchParams({
            client_id: appId,
            client_secret: appSecret,
            code,
          })
          if (redirectUri) params.append('redirect_uri', redirectUri)

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          })
          const txt = await res.text()
          let json: any
          try {
            json = JSON.parse(txt)
          } catch {
            exchangeError = { message: 'Invalid JSON response', attemptedRedirectUri: redirectUri || 'none' }
            continue
          }

          if (res.ok && json?.access_token) {
            businessToken = json.access_token
            console.log('[wa/exchange] Token obtained', {
              tokenType: json.token_type,
              expiresIn: json.expires_in,
              usedRedirectUri: redirectUri || 'none',
            })
            break
          }

          exchangeError = {
            status: res.status,
            errorCode: json?.error?.code,
            errorSubcode: json?.error?.error_subcode,
            errorMessage: json?.error?.message,
            attemptedRedirectUri: redirectUri || 'none',
          }
          console.error(`[wa/exchange] Attempt ${i + 1} failed`, exchangeError)
        } catch (fetchErr: any) {
          exchangeError = { message: fetchErr.message, type: 'network_error', attemptedRedirectUri: redirectUri || 'none' }
        }
      }
    }

    if (!businessToken) {
      return NextResponse.json({ 
        success: false, 
        message: 'Failed to obtain access token',
        exchangeError: exchangeError || 'No error details available',
        debugInfo: {
          codeProvided: !!code,
          accessTokenProvided: !!accessToken,
          messageProvided: !!message,
          hint: 'Check server logs for detailed error information'
        }
      }, { status: 400 })
    }
    
    // If we have token but no phone number ID yet, return success and wait for message event
    if (!phoneNumberId) {
      console.log('[wa/exchange] ✅ Token obtained, waiting for phone_number_id from message event')
      return NextResponse.json({ 
        success: true, 
        tokenReceived: true,
        waitingForPhoneNumber: true,
        message: 'Token received, waiting for WhatsApp phone number from setup completion'
      })
    }

    const db = prisma as any

    // If we have phone number id and token, subscribe first
    if (phoneNumberId && businessToken) {
      try {
        const sub = await subscribeWhatsAppApp({
          accessToken: businessToken,
          phoneNumberId,
          whatsappBusinessAccountId,
        })

        if (!sub.ok) {
          console.warn('[wa/exchange] subscribed_apps failed', { 
            phoneNumberId, 
            targetId: sub.targetId,
            status: sub.status, 
            data: sub.data,
            hasAppSecret: Boolean(process.env.META_APP_SECRET),
          })
        } else {
          console.log('[wa/exchange] subscribed_apps success', { phoneNumberId, targetId: sub.targetId })
        }
      } catch (e) {
        console.warn('[wa/exchange] subscribed_apps error', e)
      }
    }

    // Upsert SocialAccount when we have phone number id (accountId = phone, refreshToken = WABA)
    let saved: any = null
    if (phoneNumberId) {
      const refreshToken = encodeWhatsAppRefreshToken(whatsappBusinessAccountId)
      const existing = await db.socialAccount.findFirst({ where: { tenantId, platform: 'whatsapp', accountId: String(phoneNumberId) } })
      if (existing) {
        saved = await db.socialAccount.update({
          where: { id: existing.id },
          data: {
            userId,
            isActive: true,
            accessToken: businessToken ?? existing.accessToken ?? undefined,
            refreshToken: refreshToken ?? existing.refreshToken ?? undefined,
          },
          select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true, refreshToken: true },
        })
      } else {
        saved = await db.socialAccount.create({
          data: {
            tenantId,
            userId,
            platform: 'whatsapp',
            accountId: String(phoneNumberId),
            accessToken: businessToken ?? undefined,
            refreshToken: refreshToken ?? undefined,
            isActive: true,
          },
          select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true, refreshToken: true },
        })
      }
    }

    return NextResponse.json({
      success: true,
      account: saved
        ? {
            id: saved.id,
            platform: saved.platform,
            accountId: saved.accountId,
            isActive: saved.isActive,
            linkedAt: saved.linkedAt,
            whatsappBusinessAccountId: whatsappBusinessAccountId || null,
            phoneNumberId: phoneNumberId || null,
          }
        : null,
      tokenExchanged: Boolean(businessToken),
      phoneNumberId: phoneNumberId || null,
      whatsappBusinessAccountId: whatsappBusinessAccountId || null,
    })
  } catch (e: any) {
    console.error('[wa/exchange] Error', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
