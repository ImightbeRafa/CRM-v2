import { NextRequest, NextResponse } from 'next/server'
import { buildMetaGraphUrl, getMetaWhatsAppAppId, getMetaWhatsAppAppSecret, subscribePageToInstagramMessages } from '@/lib/meta-api'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { timingSafeEqual } from 'crypto'
import {
  buildInstagramPickerHtml,
  buildInstagramSuccessHtml,
  buildNoInstagramHtml,
  buildNoPagesHtml,
  fetchFacebookUserSummary,
  findInstagramBusinessOnPages,
  listFacebookPages,
  logInstagramPageDiscovery,
} from '@/lib/instagram-connect'
import {
  getInstagramPendingCookieName,
  INSTAGRAM_PENDING_COOKIE_MAX_AGE,
  createInstagramPendingConnect,
} from '@/lib/instagram-pending-connect'
import {
  InstagramSocialAccountConflictError,
  instagramAccountOwnedElsewhereHtml,
  upsertInstagramSocialAccount,
} from '@/lib/instagram-social-account'
import { debugMetaTokenExpiry } from '@/lib/social-account-token-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function html(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * Instagram OAuth callback
 * GET /api/auth/instagram/callback?code=...&state=...
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const errorReason = url.searchParams.get('error_reason')
    const errorDescription = url.searchParams.get('error_description')

    if (error) {
      console.error('[instagram/callback] OAuth error', { error, errorReason, errorDescription })
      const esc = (s: string | null) =>
        (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      return html(
        `<html><body>
          <h2>Error al conectar Instagram</h2>
          <p>Error: ${esc(error)}</p>
          ${errorDescription ? `<p>${esc(errorDescription)}</p>` : ''}
          <p><a href="/config/social">Volver a configuración</a></p>
        </body></html>`,
        400,
      )
    }

    if (!code) {
      return new NextResponse('Missing code', { status: 400 })
    }

    const stateParam = url.searchParams.get('state') || ''
    const storedState = request.cookies.get('ig_oauth_state')?.value || ''
    if (
      !stateParam ||
      !storedState ||
      stateParam.length !== storedState.length ||
      !timingSafeEqual(Buffer.from(stateParam), Buffer.from(storedState))
    ) {
      return new NextResponse('Invalid OAuth state — possible CSRF attack', { status: 403 })
    }

    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) {
      const status = auth.response.status
      if (status === 401) {
        return html(
          `<html><body>
            <h2>Sesión no encontrada</h2>
            <p>Por favor inicia sesión en Betsy antes de conectar Instagram.</p>
          </body></html>`,
          401,
        )
      }
      return html(
        `<html><body>
          <h2>Sin permiso</h2>
          <p>Se requiere permiso de configuración para conectar Instagram.</p>
        </body></html>`,
        403,
      )
    }

    const tenantId = auth.tenantId as string
    const userId = auth.userId as string
    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`

    console.log('[instagram/callback] Token exchange', {
      hasAppId: !!appId,
      hasAppSecret: !!appSecret,
      redirectUri,
    })

    if (!appId || !appSecret) {
      return html(
        `<html><body>
          <h2>Error de configuración</h2>
          <p>META_APP_ID o META_APP_SECRET no están configurados.</p>
        </body></html>`,
        500,
      )
    }

    const tokenUrl = `${buildMetaGraphUrl('oauth/access_token')}?${new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    })}`

    const tokenRes = await fetch(tokenUrl)
    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('[instagram/callback] Token exchange failed', errText.slice(0, 500))
      return html(
        `<html><body>
          <h2>Error al obtener token</h2>
          <p>No se pudo intercambiar el código por un token de Facebook.</p>
          <p><a href="/config/social">Volver a intentar</a></p>
        </body></html>`,
        500,
      )
    }

    const tokenData = await tokenRes.json()
    const fbAccessToken = tokenData.access_token
    if (!fbAccessToken) {
      console.error('[instagram/callback] Invalid token response', {
        error: tokenData?.error?.message || 'No access_token',
      })
      return html(
        `<html><body>
          <h2>Respuesta inválida</h2>
          <p>Facebook no devolvió un token válido. Intenta de nuevo.</p>
        </body></html>`,
        500,
      )
    }

    const facebookUser = await fetchFacebookUserSummary(fbAccessToken)
    const { pages, source } = await listFacebookPages(fbAccessToken)

    logInstagramPageDiscovery({
      pageCount: pages.length,
      pageSource: source,
      matchCount: 0,
      facebookUserId: facebookUser.id,
    })

    if (pages.length === 0) {
      return html(
        buildNoPagesHtml({
          facebookUserName: facebookUser.name,
          facebookUserId: facebookUser.id,
          pageCount: 0,
          pageSource: source,
        }),
        400,
      )
    }

    const { matches, pagesWithoutIg } = await findInstagramBusinessOnPages(pages)
    logInstagramPageDiscovery({
      pageCount: pages.length,
      pageSource: source,
      matchCount: matches.length,
      facebookUserId: facebookUser.id,
    })

    if (matches.length === 0) {
      return html(
        buildNoInstagramHtml({
          pageCount: pages.length,
          pagesWithoutIg,
        }),
        400,
      )
    }

    if (matches.length > 1) {
      const pending = await createInstagramPendingConnect({
        tenantId,
        userId,
        matches,
      })
      const response = html(buildInstagramPickerHtml(pending.publicMatches))
      response.cookies.set(getInstagramPendingCookieName(), pending.cookieToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: INSTAGRAM_PENDING_COOKIE_MAX_AGE,
        path: '/',
      })
      return response
    }

    const match = matches[0]
    let subscribeOk = false
    try {
      const sub = await subscribePageToInstagramMessages(match.pageId, match.pageAccessToken)
      subscribeOk = Boolean(sub.ok)
      if (!sub.ok) {
        console.warn('[instagram/callback] Page subscribe failed', { status: sub.status })
      } else {
        console.log('[instagram/callback] Page subscribed to app')
      }
    } catch (error) {
      console.warn('[instagram/callback] Page subscribe error', error)
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
      console.warn('[instagram/callback] debug_token expiry failed', error)
    }

    await upsertInstagramSocialAccount({
      tenantId,
      userId,
      igBusinessAccountId: match.igBusinessAccountId,
      pageAccessToken: match.pageAccessToken,
      pageId: match.pageId,
      pageName: match.pageName,
      igUsername: match.igUsername,
      isActive: subscribeOk,
      expiresAt,
    })

    if (!subscribeOk) {
      return html(
        `<html><body>
          <h2>Instagram conectado sin webhooks</h2>
          <p>La cuenta se guardó pero la suscripción a mensajes falló.</p>
          <p>Usá <strong>Re-suscribir</strong> en Configuración → Cuentas sociales.</p>
          <p><a href="/config/social">Volver</a></p>
        </body></html>`,
        422,
      )
    }

    return html(
      buildInstagramSuccessHtml({
        pageName: match.pageName,
        igUsername: match.igUsername,
      }),
    )
  } catch (error) {
    if (error instanceof InstagramSocialAccountConflictError) {
      console.warn('[instagram/callback] Instagram account already connected on another tenant')
      return html(instagramAccountOwnedElsewhereHtml(), 409)
    }
    console.error('[instagram/callback] Unexpected error', error)
    return html(
      `<html><body>
        <h2>Error inesperado</h2>
        <p>Ocurrió un error al conectar Instagram. Por favor intenta de nuevo.</p>
        <p><a href="/config/social">Volver</a></p>
      </body></html>`,
      500,
    )
  }
}
