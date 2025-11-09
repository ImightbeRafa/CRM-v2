import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'

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
      
      console.log('[wa/exchange] 🔍 DIAGNOSTIC INFO:', {
        '1. Code length': code.length,
        '2. Code prefix': code.substring(0, 15) + '...',
        '3. App ID': appId,
        '4. Config ID from env': process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID,
        '5. NEXTAUTH_URL': process.env.NEXTAUTH_URL
      })
      
      // Note: debug_token API only works with access tokens, not authorization codes
      // The authorization code will be exchanged for a token in the attempts below
      
      // CRITICAL: Found the actual redirect_uri from OAuth dialog URL!
      // The SDK uses staticxx.facebook.com/x/connect/xd_arbiter/ WITH version parameter
      const redirectUriCandidates = [
        // 1. ACTUAL redirect_uri from OAuth dialog (with version=46)
        'https://staticxx.facebook.com/x/connect/xd_arbiter/?version=46',
        // 2. Without hash fragment (Meta might strip it)
        'https://staticxx.facebook.com/x/connect/xd_arbiter/',
        // 3. Fallback redirect_uri from OAuth dialog
        process.env.NEXTAUTH_URL + '/config/social',
        // 4. Root domain with trailing slash
        process.env.NEXTAUTH_URL + '/',
        // 5. Root domain without trailing slash
        process.env.NEXTAUTH_URL,
        // 6. No redirect_uri
        null,
        // 7. Custom callback from env
        process.env.FB_LOGIN_REDIRECT_URI,
        // 8. Facebook's internal success page
        'https://www.facebook.com/platform/app-login-success/',
        // 9. Common Facebook defaults
        'https://www.facebook.com/connect/login_success.html',
      ].filter(uri => uri !== undefined) // Keep null, but remove undefined
      
      const url = `https://graph.facebook.com/v24.0/oauth/access_token`
      
      // Try each redirect_uri candidate until one works
      for (let i = 0; i < redirectUriCandidates.length; i++) {
        const redirectUri = redirectUriCandidates[i]
        
        try {
          const params = new URLSearchParams({
            client_id: appId,
            client_secret: appSecret,
            code,
          })
          
          if (redirectUri) {
            params.append('redirect_uri', redirectUri as string)
            console.log(`[wa/exchange] Attempt ${i + 1}/${redirectUriCandidates.length}: redirect_uri="${redirectUri}"`)
            console.log(`[wa/exchange] Full request params:`, params.toString())
          } else {
            console.log(`[wa/exchange] Attempt ${i + 1}/${redirectUriCandidates.length}: NO redirect_uri`)
            console.log(`[wa/exchange] Full request params:`, params.toString())
          }
          
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          })
          
          const txt = await res.text()
          console.log('[wa/exchange] Response status:', res.status)
          
          let json: any
          try {
            json = JSON.parse(txt)
          } catch (parseErr) {
            console.error('[wa/exchange] Failed to parse response as JSON:', txt)
            exchangeError = { message: 'Invalid JSON response', raw: txt, attemptedRedirectUri: redirectUri }
            continue // Try next candidate
          }
          
          if (res.ok && json?.access_token) {
            businessToken = json.access_token
            console.log('[wa/exchange] ✅ SUCCESS - Token obtained', {
              tokenType: json.token_type,
              expiresIn: json.expires_in,
              tokenPrefix: json.access_token.substring(0, 20) + '...',
              usedRedirectUri: redirectUri || 'none'
            })
            break // Success! Exit the loop
          } else {
            // Log detailed error information
            const errorDetails = {
              status: res.status,
              statusText: res.statusText,
              error: json?.error,
              errorCode: json?.error?.code,
              errorSubcode: json?.error?.error_subcode,
              errorMessage: json?.error?.message,
              errorType: json?.error?.type,
              fbTraceId: json?.error?.fbtrace_id,
              rawResponse: txt,
              attemptedRedirectUri: redirectUri || 'none'
            }
            
            console.error(`[wa/exchange] ❌ Attempt ${i + 1} FAILED`, errorDetails)
            exchangeError = errorDetails
            
            // Provide helpful debugging info for common errors
            if (json?.error?.code === 100) {
              if (json?.error?.error_subcode === 36008) {
                console.error('[wa/exchange] ERROR 36008: Redirect URI mismatch')
                console.error('[wa/exchange] Tried redirect_uri:', redirectUri || 'none')
              }
            } else if (json?.error?.code === 190) {
              console.error('[wa/exchange] ERROR 190: Invalid OAuth 2.0 Access Token')
              console.error('[wa/exchange] The authorization code may have expired (30 sec TTL)')
            } else if (json?.error?.code === 191) {
              console.error('[wa/exchange] ERROR 191: Domain not allowed for this redirect_uri')
            }
            
            // Try next candidate if not the last attempt
            if (i < redirectUriCandidates.length - 1) {
              console.log(`[wa/exchange] Trying next redirect_uri candidate (${i + 2}/${redirectUriCandidates.length})...`)
              continue
            }
          }
        } catch (fetchErr: any) {
          console.error('[wa/exchange] Network error during token exchange:', fetchErr)
          exchangeError = { message: fetchErr.message, type: 'network_error', attemptedRedirectUri: redirectUri }
          // Try next candidate on network error
          if (i < redirectUriCandidates.length - 1) continue
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
        const subscribeUrl = `https://graph.facebook.com/v24.0/${encodeURIComponent(phoneNumberId)}/subscribed_apps`
        const form = new URLSearchParams({ access_token: businessToken })
        const subRes = await fetch(subscribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        })
        const subText = await subRes.text()
        if (!subRes.ok) {
          console.warn('[wa/exchange] subscribed_apps failed', { phoneNumberId, status: subRes.status, subText })
        } else {
          console.log('[wa/exchange] subscribed_apps success', { phoneNumberId, subText })
        }
      } catch (e) {
        console.warn('[wa/exchange] subscribed_apps error', e)
      }
    }

    // Upsert SocialAccount when we have phone number id
    let saved: any = null
    if (phoneNumberId) {
      const existing = await db.socialAccount.findFirst({ where: { tenantId, platform: 'whatsapp', accountId: String(phoneNumberId) } })
      if (existing) {
        saved = await db.socialAccount.update({
          where: { id: existing.id },
          data: {
            userId,
            isActive: true,
            accessToken: businessToken ?? existing.accessToken ?? undefined,
          },
          select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true },
        })
      } else {
        saved = await db.socialAccount.create({
          data: {
            tenantId,
            userId,
            platform: 'whatsapp',
            accountId: String(phoneNumberId),
            accessToken: businessToken ?? undefined,
            isActive: true,
          },
          select: { id: true, platform: true, accountId: true, isActive: true, linkedAt: true },
        })
      }
    }

    return NextResponse.json({ success: true, account: saved, tokenExchanged: Boolean(businessToken), phoneNumberId: phoneNumberId || null })
  } catch (e: any) {
    console.error('[wa/exchange] Error', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
