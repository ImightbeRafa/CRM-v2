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
    // Use META_APP_ID (main BetsyCRM app) - same for WhatsApp and Instagram
    const appId = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    
    console.log('[instagram/callback] Token exchange', {
      hasAppId: !!appId,
      hasAppSecret: !!appSecret,
      redirectUri: `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`,
    })
    
    if (!appId || !appSecret) {
      const html = `
        <html><body>
          <h2>Error de configuración</h2>
          <p>META_APP_ID o META_APP_SECRET no están configurados.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
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
    const pagesUrl = `https://graph.facebook.com/v21.0/me/accounts?access_token=${fbAccessToken}`
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

    // Step 3: Search ALL pages for Instagram Business Account (not just the first one)
    console.log('[instagram/callback] Found', pages.length, 'Facebook pages, checking each for Instagram Business...')
    
    let igBusinessAccountId: string | null = null
    let pageId: string | null = null
    let pageAccessToken: string | null = null
    let pageName: string | null = null
    const pagesWithoutIG: string[] = []

    for (const page of pages) {
      const igAccountUrl = `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account,name&access_token=${page.access_token}`
      const igAccountUrlWithProof = addAppSecretProofToUrl(igAccountUrl, page.access_token)
      
      try {
        const igAccountRes = await fetch(igAccountUrlWithProof)
        if (igAccountRes.ok) {
          const igAccountData = await igAccountRes.json()
          console.log('[instagram/callback] Page:', igAccountData.name, '- IG Business:', igAccountData.instagram_business_account?.id || 'NOT LINKED')
          
          if (igAccountData.instagram_business_account?.id) {
            igBusinessAccountId = igAccountData.instagram_business_account.id
            pageId = page.id
            pageAccessToken = page.access_token
            pageName = igAccountData.name
            console.log('[instagram/callback] ✅ Found Instagram Business on page:', pageName)
            break // Found one, stop searching
          } else {
            pagesWithoutIG.push(igAccountData.name || page.id)
          }
        }
      } catch (e) {
        console.warn('[instagram/callback] Error checking page', page.id, e)
      }
    }

    if (!igBusinessAccountId || !pageId || !pageAccessToken) {
      const pagesList = pagesWithoutIG.length > 0 
        ? `<p><strong>Páginas encontradas sin Instagram Business:</strong></p><ul>${pagesWithoutIG.map(p => `<li>${p}</li>`).join('')}</ul>`
        : ''
      
      const html = `
        <html><body style="font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px;">
          <h2>❌ No se encontró cuenta de Instagram Business</h2>
          <p>Revisamos ${pages.length} página(s) de Facebook pero ninguna tiene una cuenta de Instagram Business vinculada.</p>
          ${pagesList}
          <hr style="margin: 20px 0;">
          <h3>¿Cómo vincular Instagram Business a tu página?</h3>
          <ol>
            <li>Abre la app de <strong>Instagram</strong> en tu celular</li>
            <li>Ve a <strong>Configuración</strong> → <strong>Cuenta</strong> → <strong>Cambiar a cuenta profesional</strong></li>
            <li>Selecciona <strong>"Empresa"</strong> (no "Creador")</li>
            <li>Conecta tu <strong>Página de Facebook</strong> cuando te lo pida</li>
            <li>Vuelve aquí e intenta conectar de nuevo</li>
          </ol>
          <p style="margin-top: 20px;"><strong>Nota:</strong> Las cuentas de "Creador" NO funcionan con la API de mensajes. Debe ser cuenta de <strong>Empresa/Business</strong>.</p>
          <p><a href="/config/social">← Volver a configuración</a></p>
        </body></html>
      `
      return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Subscribe the Page to this app for messaging webhooks (required for IG messaging delivery)
    try {
      const subscribeUrl = `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`
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
