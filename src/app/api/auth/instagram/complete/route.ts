import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { subscribePageToInstagramMessages } from '@/lib/meta-api'
import { buildInstagramSuccessHtml } from '@/lib/instagram-connect'
import {
  clearInstagramPending,
  getInstagramPendingCookieName,
  loadInstagramPendingRecord,
} from '@/lib/instagram-pending-connect'
import {
  InstagramSocialAccountConflictError,
  instagramAccountOwnedElsewhereHtml,
  upsertInstagramSocialAccount,
} from '@/lib/instagram-social-account'
import { debugMetaTokenExpiry } from '@/lib/social-account-token-health'
import { getMetaWhatsAppAppId, getMetaWhatsAppAppSecret } from '@/lib/meta-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) {
      return new NextResponse(
        auth.response.status === 401
          ? 'Sesión no encontrada'
          : 'Sin permiso para completar la conexión de Instagram',
        { status: auth.response.status },
      )
    }

    const pendingRaw = request.cookies.get(getInstagramPendingCookieName())?.value || ''
    const loaded = pendingRaw
      ? await loadInstagramPendingRecord(pendingRaw, {
          tenantId: String(auth.tenantId),
          userId: String(auth.userId),
        })
      : null
    if (!loaded) {
      return new NextResponse('Sesión de conexión expirada. Vuelve a intentar desde /config/social.', {
        status: 400,
      })
    }

    // Bind cookie claims to the active session (SD-01).
    if (
      loaded.cookie.tenantId !== auth.tenantId ||
      loaded.cookie.userId !== auth.userId ||
      loaded.record.tenantId !== auth.tenantId ||
      loaded.record.userId !== auth.userId
    ) {
      return new NextResponse('Sesión de conexión no coincide con el usuario autenticado.', {
        status: 403,
      })
    }

    const form = await request.formData().catch(() => null)
    const selectionRaw = form?.get('selection')
    const index = Number(selectionRaw)
    const match = loaded.record.matches[index]
    if (!match) {
      return new NextResponse('Selección inválida', { status: 400 })
    }

    // Cookie only listed page ids — ensure selection is one of them.
    if (!loaded.cookie.pageIds.includes(match.pageId)) {
      return new NextResponse('Selección no autorizada', { status: 403 })
    }

    let subscribeOk = false
    try {
      const sub = await subscribePageToInstagramMessages(match.pageId, match.pageAccessToken)
      subscribeOk = Boolean(sub.ok)
      if (!sub.ok) {
        console.warn('[instagram/complete] Page subscribe failed', { status: sub.status })
      }
    } catch (error) {
      console.warn('[instagram/complete] Page subscribe error', error)
      subscribeOk = false
    }

    let expiresAt: Date | null = null
    try {
      const appId = getMetaWhatsAppAppId() || process.env.META_APP_ID
      const appSecret = getMetaWhatsAppAppSecret() || process.env.META_APP_SECRET
      if (appId && appSecret) {
        expiresAt = await debugMetaTokenExpiry({
          inputToken: match.pageAccessToken,
          appAccessToken: `${appId}|${appSecret}`,
        })
      }
    } catch (error) {
      console.warn('[instagram/complete] debug_token expiry failed', error)
    }

    await upsertInstagramSocialAccount({
      tenantId: loaded.record.tenantId,
      userId: loaded.record.userId,
      igBusinessAccountId: match.igBusinessAccountId,
      pageAccessToken: match.pageAccessToken,
      pageId: match.pageId,
      pageName: match.pageName,
      igUsername: match.igUsername,
      isActive: subscribeOk,
      expiresAt,
    })

    await clearInstagramPending(loaded.cookie.pendingId)

    if (!subscribeOk) {
      const response = new NextResponse(
        `<html><body>
          <h2>Instagram conectado sin webhooks</h2>
          <p>La cuenta se guardó pero la suscripción a mensajes falló.</p>
          <p>Usá <strong>Re-suscribir</strong> en Configuración → Cuentas sociales.</p>
        </body></html>`,
        { status: 422, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
      response.cookies.set(getInstagramPendingCookieName(), '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      })
      return response
    }

    const response = new NextResponse(
      buildInstagramSuccessHtml({
        pageName: match.pageName,
        igUsername: match.igUsername,
      }),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
    response.cookies.set(getInstagramPendingCookieName(), '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return response
  } catch (error) {
    if (error instanceof InstagramSocialAccountConflictError) {
      console.warn('[instagram/complete] Instagram account already connected on another tenant')
      return new NextResponse(instagramAccountOwnedElsewhereHtml(), {
        status: 409,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    console.error('[instagram/complete] Unexpected error', error)
    return new NextResponse('Error inesperado al completar la conexión de Instagram.', { status: 500 })
  }
}
