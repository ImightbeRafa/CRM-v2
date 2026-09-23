import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import {
  buildMetaGraphUrl,
  subscribeWhatsAppApp,
  verifyWhatsAppAssetsForToken,
  verifyWhatsAppCoexistenceStatus,
  resolvePhoneNumberIdFromWaba,
  initiateWhatsAppSmbAppDataSync,
  getMetaWhatsAppAppId,
  getMetaWhatsAppAppSecret,
} from '@/lib/meta-api'
import { encodeWhatsAppRefreshToken } from '@/lib/social-account-meta'
import { encryptSocialAccessToken } from '@/lib/social-account-crypto'
import { identityPersistPayload } from '@/lib/social-account-identity'
import {
  extractWaEmbeddedSignupAssets,
  isWaEmbeddedSignupMessage,
  shouldDeferWhatsAppCodeExchange,
  shouldIgnoreWaSessionEvent,
} from '@/lib/whatsapp-embedded-signup'
import {
  expiresAtFromExpiresIn,
  reconnectLifecycleData,
} from '@/lib/social-account-token-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/whatsapp/exchange
 * Body: { code?: string, accessToken?: string, message?: WA_EMBEDDED_SIGNUP payload }
 * - Exchanges Embedded Signup 'code' for a business token
 * - Supports coexistence FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (waba_id only)
 * - Graph-verifies phone/WABA ownership before upsert/subscribe
 * - Subscribes coexistence webhook fields and initiates SMB sync when applicable
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const tenantId = String(auth.tenantId)
    const userId = String(auth.userId)

    const body = await request.json().catch(() => ({}))
    const code: string | undefined = body?.code
    const accessToken: string | undefined = body?.accessToken
    const message = isWaEmbeddedSignupMessage(body?.message) ? body.message : body?.message

    if (message?.event && shouldIgnoreWaSessionEvent(message.event)) {
      return NextResponse.json({
        success: false,
        cancelled: true,
        message: 'WhatsApp Embedded Signup cancelado o con error en Meta.',
        event: message.event,
      })
    }

    const sessionAssets = extractWaEmbeddedSignupAssets(
      isWaEmbeddedSignupMessage(message) ? message : undefined,
    )

    // Client-supplied ids are untrusted until Graph-verified below.
    const claimedPhoneNumberId: string | null =
      sessionAssets.phoneNumberId ||
      message?.data?.phone_number_id ||
      message?.phone_number_id ||
      body?.phoneNumberId ||
      null
    let claimedWabaId: string | null =
      sessionAssets.wabaId ||
      message?.data?.waba_id ||
      message?.data?.whatsapp_business_account_id ||
      message?.waba_id ||
      message?.whatsapp_business_account_id ||
      body?.whatsappBusinessAccountId ||
      null
    const coexistenceFinish = sessionAssets.coexistence

    let tokenExpiresIn: number | null = null
    let businessToken: string | null = accessToken || null
    let exchangeError: any = null

    if (
      shouldDeferWhatsAppCodeExchange({
        code,
        accessToken,
        phoneNumberId: claimedPhoneNumberId,
        wabaId: claimedWabaId,
      })
    ) {
      console.log('[wa/exchange] Deferring single-use code until phone/WABA assets arrive')
      return NextResponse.json({
        success: true,
        tokenReceived: false,
        waitingForPhoneNumber: true,
        deferredCodeExchange: true,
        message:
          'Esperando phone_number_id o waba_id del Embedded Signup antes de intercambiar el código.',
      })
    }

    if (accessToken) {
      console.log('[wa/exchange] Access token provided directly (response_type=token)')
    } else if (code) {
      const appId = getMetaWhatsAppAppId()
      const appSecret = getMetaWhatsAppAppSecret()

      if (!appId || !appSecret) {
        console.error('[wa/exchange] Missing META_WA_APP_ID/META_APP_ID or META_WA_APP_SECRET/META_APP_SECRET')
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
      }

      console.log('[wa/exchange] Exchanging Embedded Signup code', {
        codeLength: code.length,
        hasConfigId: Boolean(process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID),
        hasNextAuthUrl: Boolean(process.env.NEXTAUTH_URL),
        usingDedicatedWaApp: Boolean((process.env.META_WA_APP_ID || '').trim()),
        coexistenceFinish,
        sessionEvent: sessionAssets.event,
      })

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
            if (json.expires_in != null) tokenExpiresIn = Number(json.expires_in)
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
          exchangeError = {
            message: fetchErr.message,
            type: 'network_error',
            attemptedRedirectUri: redirectUri || 'none',
          }
        }
      }
    }

    if (!businessToken) {
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to obtain access token',
          exchangeError: exchangeError || 'No error details available',
          debugInfo: {
            codeProvided: !!code,
            accessTokenProvided: !!accessToken,
            messageProvided: !!message,
            hint: 'Check server logs for detailed error information',
          },
        },
        { status: 400 },
      )
    }

    let resolvedPhoneClaim = claimedPhoneNumberId ? String(claimedPhoneNumberId) : null

    // Coexistence often returns only waba_id — resolve phone via Graph before waiting.
    if (!resolvedPhoneClaim && claimedWabaId) {
      const fromWaba = await resolvePhoneNumberIdFromWaba({
        wabaId: String(claimedWabaId),
        accessToken: businessToken,
      })
      if (fromWaba.ok && fromWaba.phoneNumberId) {
        resolvedPhoneClaim = fromWaba.phoneNumberId
        claimedWabaId = fromWaba.whatsappBusinessAccountId || claimedWabaId
        console.log('[wa/exchange] Resolved phone from WABA (coexistence)', {
          phoneNumberId: resolvedPhoneClaim,
          wabaId: claimedWabaId,
          coexistence: fromWaba.coexistence,
        })
      } else if (coexistenceFinish) {
        console.warn('[wa/exchange] Coexistence finish but could not resolve phone from WABA', {
          reason: fromWaba.reason,
          phoneCount: fromWaba.phones?.length ?? 0,
        })
        return NextResponse.json(
          {
            success: false,
            message:
              fromWaba.reason === 'ambiguous_coexistence_phones' ||
              fromWaba.reason === 'ambiguous_phones_on_waba' ||
              fromWaba.reason === 'ambiguous_biz_app_phones'
                ? 'La WABA tiene varios números; no se pudo elegir cuál conectar. Vinculá manualmente el Phone Number ID.'
                : 'Coexistence completó en Meta pero no se encontró un número en la WABA. Verificá que el número esté en la app de WhatsApp Business (2.24.17+).',
            reason: fromWaba.reason || 'coexistence_phone_resolve_failed',
            whatsappBusinessAccountId: claimedWabaId,
            phoneCount: fromWaba.phones?.length ?? 0,
          },
          { status: 422 },
        )
      }
    }

    if (!resolvedPhoneClaim) {
      console.log('[wa/exchange] Token obtained, waiting for phone_number_id from message event')
      return NextResponse.json({
        success: true,
        tokenReceived: true,
        waitingForPhoneNumber: true,
        message: 'Token received, waiting for WhatsApp phone number from setup completion',
      })
    }

    // SD-02: never upsert/subscribe on client-claimed ids alone.
    const ownership = await verifyWhatsAppAssetsForToken({
      accessToken: businessToken,
      phoneNumberId: String(resolvedPhoneClaim),
      whatsappBusinessAccountId: claimedWabaId,
    })

    if (!ownership.ok || !ownership.phoneNumberId) {
      console.warn('[wa/exchange] Graph ownership check failed', {
        reason: ownership.reason,
        claimedPhone: Boolean(resolvedPhoneClaim),
        claimedWaba: Boolean(claimedWabaId),
      })
      return NextResponse.json(
        {
          success: false,
          message: 'WhatsApp phone/WABA could not be verified for this token',
          reason: ownership.reason || 'ownership_failed',
        },
        { status: 403 },
      )
    }

    const phoneNumberId = ownership.phoneNumberId
    const whatsappBusinessAccountId = ownership.whatsappBusinessAccountId

    let coexistenceStatus: {
      isOnBizApp: boolean | null
      platformType: string | null
    } | null = null
    if (coexistenceFinish) {
      const status = await verifyWhatsAppCoexistenceStatus({
        phoneNumberId,
        accessToken: businessToken,
      })
      coexistenceStatus = {
        isOnBizApp: status.isOnBizApp,
        platformType: status.platformType,
      }
      console.log('[wa/exchange] Coexistence status', coexistenceStatus)
    }

    const db = prisma as any

    let subscribeOk = false
    let subscribeStatus: number | null = null
    let subscribeTargetId: string | null = null
    let subscribeDetails: unknown = null
    let subscribeErrorMessage: string | null = null
    let subscribedFields: string | null = null

    try {
      const sub = await subscribeWhatsAppApp({
        accessToken: businessToken,
        phoneNumberId,
        whatsappBusinessAccountId,
      })
      subscribeOk = sub.ok
      subscribeStatus = sub.status
      subscribeTargetId = sub.targetId
      subscribeDetails = sub.data
      subscribedFields = sub.subscribedFields

      if (!sub.ok) {
        console.warn('[wa/exchange] subscribed_apps failed', {
          phoneNumberId,
          targetId: sub.targetId,
          status: sub.status,
          hasAppSecret: Boolean(getMetaWhatsAppAppSecret()),
          usingDedicatedWaApp: Boolean((process.env.META_WA_APP_ID || '').trim()),
        })
      } else {
        console.log('[wa/exchange] subscribed_apps success', {
          phoneNumberId,
          targetId: sub.targetId,
          subscribedFields: sub.subscribedFields,
        })
      }
    } catch (e) {
      subscribeErrorMessage = e instanceof Error ? e.message : 'Subscribe error'
      console.warn('[wa/exchange] subscribed_apps error', e)
    }

    // Persist token even on subscribe failure so Re-suscribir can retry, but
    // isActive (and success) only when webhooks are subscribed — "conectado" ⇒ subscribed.
    const refreshToken = encodeWhatsAppRefreshToken(whatsappBusinessAccountId)
    const encryptedToken = businessToken
      ? encryptSocialAccessToken(businessToken)
      : undefined
    const existing = await db.socialAccount.findFirst({
      where: { tenantId, platform: 'whatsapp', accountId: String(phoneNumberId) },
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        displayName: true,
      },
    })
    const identity = identityPersistPayload({
      platform: 'whatsapp',
      providerDisplayName: ownership.providerDisplayName,
      displayPhoneNumber: ownership.displayPhoneNumber,
      wabaId: whatsappBusinessAccountId,
      existingDisplayName: existing?.displayName,
    })
    const identityData = {
      providerDisplayName: identity.providerDisplayName,
      displayPhoneNumber: identity.displayPhoneNumber,
      wabaId: identity.wabaId,
      displayName: identity.displayName,
    }
    let saved: any
    if (existing) {
      saved = await db.socialAccount.update({
        where: { id: existing.id },
        data: {
          userId,
          ...reconnectLifecycleData({
            isActive: subscribeOk,
            expiresAt: expiresAtFromExpiresIn(tokenExpiresIn),
          }),
          accessToken: encryptedToken ?? existing.accessToken ?? undefined,
          refreshToken: refreshToken ?? existing.refreshToken ?? undefined,
          ...identityData,
        },
        select: {
          id: true,
          platform: true,
          accountId: true,
          isActive: true,
          linkedAt: true,
          refreshToken: true,
          displayName: true,
          providerDisplayName: true,
          displayPhoneNumber: true,
          wabaId: true,
        },
      })
    } else {
      saved = await db.socialAccount.create({
        data: {
          tenantId,
          userId,
          platform: 'whatsapp',
          accountId: String(phoneNumberId),
          accessToken: encryptedToken ?? undefined,
          refreshToken: refreshToken ?? undefined,
          ...reconnectLifecycleData({
            isActive: subscribeOk,
            expiresAt: expiresAtFromExpiresIn(tokenExpiresIn),
          }),
          ...identityData,
        },
        select: {
          id: true,
          platform: true,
          accountId: true,
          isActive: true,
          linkedAt: true,
          refreshToken: true,
          displayName: true,
          providerDisplayName: true,
          displayPhoneNumber: true,
          wabaId: true,
        },
      })
    }

    const accountPayload = {
      id: saved.id,
      platform: saved.platform,
      accountId: saved.accountId,
      isActive: saved.isActive,
      linkedAt: saved.linkedAt,
      whatsappBusinessAccountId: whatsappBusinessAccountId || saved.wabaId || null,
      phoneNumberId: phoneNumberId || null,
      displayName: saved.displayName || null,
      providerDisplayName: saved.providerDisplayName || null,
      displayPhoneNumber: saved.displayPhoneNumber || null,
      wabaId: saved.wabaId || whatsappBusinessAccountId || null,
    }

    if (!subscribeOk) {
      return NextResponse.json(
        {
          success: false,
          subscribed: false,
          message:
            'WhatsApp no quedó suscrito a webhooks (subscribed_apps falló). Sin esto no recibirás mensajes en /chats. Revisa permisos del token o usa Re-suscribir.',
          reason: 'subscribe_failed',
          status: subscribeStatus,
          targetId: subscribeTargetId,
          details: subscribeDetails,
          error: subscribeErrorMessage,
          account: accountPayload,
          tokenExchanged: Boolean(businessToken),
          phoneNumberId,
          whatsappBusinessAccountId: whatsappBusinessAccountId || null,
          coexistence: coexistenceFinish,
          coexistenceStatus,
        },
        { status: 422 },
      )
    }

    // Coexistence: initiate contacts + history sync within 24h (best-effort; log request ids).
    let smbSync: {
      contacts?: { ok: boolean; requestId: string | null }
      history?: { ok: boolean; requestId: string | null }
    } | null = null
    if (coexistenceFinish || coexistenceStatus?.isOnBizApp === true) {
      smbSync = {}
      try {
        const contacts = await initiateWhatsAppSmbAppDataSync({
          phoneNumberId,
          accessToken: businessToken,
          syncType: 'smb_app_state_sync',
        })
        smbSync.contacts = { ok: contacts.ok, requestId: contacts.requestId }
        console.log('[wa/exchange] SMB contacts sync', smbSync.contacts)
      } catch (e) {
        console.warn('[wa/exchange] SMB contacts sync error', e)
        smbSync.contacts = { ok: false, requestId: null }
      }
      try {
        const history = await initiateWhatsAppSmbAppDataSync({
          phoneNumberId,
          accessToken: businessToken,
          syncType: 'history',
        })
        smbSync.history = { ok: history.ok, requestId: history.requestId }
        console.log('[wa/exchange] SMB history sync', smbSync.history)
      } catch (e) {
        console.warn('[wa/exchange] SMB history sync error', e)
        smbSync.history = { ok: false, requestId: null }
      }
    }

    return NextResponse.json({
      success: true,
      subscribed: true,
      subscribedFields,
      account: accountPayload,
      tokenExchanged: Boolean(businessToken),
      phoneNumberId,
      whatsappBusinessAccountId: whatsappBusinessAccountId || null,
      coexistence: coexistenceFinish || coexistenceStatus?.isOnBizApp === true,
      coexistenceStatus,
      smbSync,
      message:
        coexistenceFinish || coexistenceStatus?.isOnBizApp === true
          ? 'WhatsApp Business App conectado (coexistence). Sincronizando historial/contactos… Dejá la app abierta unos minutos.'
          : undefined,
    })
  } catch (e: any) {
    console.error('[wa/exchange] Error', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
