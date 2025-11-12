import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { addAppSecretProofToUrl } from '@/lib/meta-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Instagram OAuth callback
 * GET /api/auth/instagram/callback?code=...&state=...
 * Exchanges code for short-lived token, then long-lived token, then stores to SocialAccount.
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
      const html = `
        <html><body>
          <h2>Error al conectar Instagram</h2>
          <p>Error: ${error}</p>
          ${errorDescription ? `<p>${errorDescription}</p>` : ''}
          <p>Puedes cerrar esta ventana y volver a la app.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    if (!code) {
      return new NextResponse('Missing code', { status: 400 })
    }

    // Get session to identify tenant/user
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token || !token.tenantId || !token.sub) {
      const html = `
        <html><body>
          <h2>Sesión no encontrada</h2>
          <p>Por favor inicia sesión en Betsy antes de conectar Instagram.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const tenantId = token.tenantId as string
    const userId = token.sub as string

    // Step 1: Exchange code for Facebook access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?${new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET!,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`,
      code,
    })}`
    
    const tokenRes = await fetch(tokenUrl)

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('[instagram/callback] Token exchange failed', errText)
      const html = `
        <html><body>
          <h2>Error al obtener token</h2>
          <p>No se pudo intercambiar el código por un token de Facebook.</p>
          <pre>${errText}</pre>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const tokenData = await tokenRes.json()
    const fbAccessToken = tokenData.access_token

    if (!fbAccessToken) {
      console.error('[instagram/callback] Invalid token response', tokenData)
      const html = `
        <html><body>
          <h2>Respuesta inválida</h2>
          <p>Facebook no devolvió un token válido.</p>
          <pre>${JSON.stringify(tokenData, null, 2)}</pre>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Step 2: Get Facebook Pages connected to this user
    const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token=${fbAccessToken}`
    const pagesUrlWithProof = addAppSecretProofToUrl(pagesUrl, fbAccessToken)
    
    const pagesRes = await fetch(pagesUrlWithProof)
    if (!pagesRes.ok) {
      const errText = await pagesRes.text()
      console.error('[instagram/callback] Failed to get pages', errText)
      const html = `
        <html><body>
          <h2>Error al obtener páginas</h2>
          <p>No se pudieron obtener las páginas de Facebook.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const pagesData = await pagesRes.json()
    const pages = pagesData.data || []

    if (pages.length === 0) {
      const html = `
        <html><body>
          <h2>No se encontraron páginas</h2>
          <p>No tienes páginas de Facebook conectadas. Necesitas una página de Facebook vinculada a una cuenta de Instagram Business.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Step 3: Get Instagram Business Account from the first page
    const pageId = pages[0].id
    const pageAccessToken = pages[0].access_token

    const igAccountUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
    const igAccountUrlWithProof = addAppSecretProofToUrl(igAccountUrl, pageAccessToken)
    
    const igAccountRes = await fetch(igAccountUrlWithProof)
    if (!igAccountRes.ok) {
      const errText = await igAccountRes.text()
      console.error('[instagram/callback] Failed to get IG account', errText)
      const html = `
        <html><body>
          <h2>Error al obtener cuenta de Instagram</h2>
          <p>No se pudo obtener la cuenta de Instagram Business vinculada a tu página.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const igAccountData = await igAccountRes.json()
    const igBusinessAccountId = igAccountData.instagram_business_account?.id

    if (!igBusinessAccountId) {
      const html = `
        <html><body>
          <h2>No se encontró cuenta de Instagram Business</h2>
          <p>Tu página de Facebook no tiene una cuenta de Instagram Business vinculada.</p>
          <p>Por favor vincula una cuenta de Instagram Business a tu página de Facebook primero.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Subscribe the Page to this app for messaging webhooks (required for IG messaging delivery)
    try {
      const subscribeUrl = `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`
      const subscribeUrlWithProof = addAppSecretProofToUrl(subscribeUrl, pageAccessToken)
      
      const subscribeParams = new URLSearchParams({
        access_token: pageAccessToken,
        subscribed_fields: 'messages'
      })
      const subRes = await fetch(subscribeUrlWithProof, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: subscribeParams
      })
      const subText = await subRes.text()
      if (!subRes.ok) {
        console.warn('[instagram/callback] Page subscribe failed', { 
          status: subRes.status, 
          subText, 
          hasAppSecret: Boolean(process.env.META_APP_SECRET),
          urlUsed: subscribeUrlWithProof.replace(/appsecret_proof=[^&]+/, 'appsecret_proof=***')
        })
      } else {
        console.log('[instagram/callback] Page subscribed to app', subText)
      }
    } catch (e) {
      console.warn('[instagram/callback] Page subscribe error', e)
    }

    // Use page access token as the long-lived token (doesn't expire unless revoked)
    const longLivedToken = pageAccessToken
    const expiresIn = 5184000 // 60 days (page tokens don't expire but we set a refresh reminder)

    // Store in SocialAccount
    const db = prisma as any
    const expiresAt = new Date(Date.now() + expiresIn * 1000)

    const existing = await db.socialAccount.findFirst({
      where: { tenantId, platform: 'instagram', accountId: String(igBusinessAccountId) }
    })

    if (existing) {
      await db.socialAccount.update({
        where: { id: existing.id },
        data: { accessToken: longLivedToken, expiresAt, isActive: true }
      })
    } else {
      await db.socialAccount.create({
        data: {
          tenantId,
          userId,
          platform: 'instagram',
          accountId: String(igBusinessAccountId),
          accessToken: longLivedToken,
          expiresAt,
          isActive: true
        }
      })
    }

    const html = `
      <html><body>
        <h2>Instagram conectado</h2>
        <p>Tu cuenta de Instagram ha sido vinculada a Betsy.</p>
        <p>Puedes cerrar esta ventana y volver a la app.</p>
      </body></html>
    `
    return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (e: any) {
    console.error('[instagram/callback] Unexpected error', e)
    const html = `
      <html><body>
        <h2>Error inesperado</h2>
        <p>${e.message || 'Ocurrió un error al conectar Instagram.'}</p>
      </body></html>
    `
    return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
}
