import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { addAppSecretProofToUrl, buildMetaGraphUrl, subscribePageToInstagramMessages } from '@/lib/meta-api'
import { timingSafeEqual } from 'crypto'

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
      const esc = (s: string | null) => (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const html = `
        <html><body>
          <h2>Error al conectar Instagram</h2>
          <p>Error: ${esc(error)}</p>
          ${errorDescription ? `<p>${esc(errorDescription)}</p>` : ''}
          <p>Puedes cerrar esta ventana y volver a la app.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    if (!code) {
      return new NextResponse('Missing code', { status: 400 })
    }

    const stateParam = url.searchParams.get('state') || ''
    const storedState = request.cookies.get('ig_oauth_state')?.value || ''
    if (!stateParam || !storedState || stateParam.length !== storedState.length ||
        !timingSafeEqual(Buffer.from(stateParam), Buffer.from(storedState))) {
      return new NextResponse('Invalid OAuth state — possible CSRF attack', { status: 403 })
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
    
    const tokenUrl = `${buildMetaGraphUrl('oauth/access_token')}?${new URLSearchParams({
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
          <p>Por favor intenta de nuevo o contacta soporte.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const tokenData = await tokenRes.json()
    const fbAccessToken = tokenData.access_token

    if (!fbAccessToken) {
      // Don't log full token data
      console.error('[instagram/callback] Invalid token response - error:', tokenData?.error?.message || 'No access_token')
      const html = `
        <html><body>
          <h2>Respuesta inválida</h2>
          <p>Facebook no devolvió un token válido.</p>
          <p>Facebook no devolvió un token válido. Intenta de nuevo.</p>
        </body></html>
      `
      return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Step 2: Get Facebook Pages connected to this user
    const pagesUrl = `${buildMetaGraphUrl('me/accounts')}?access_token=${fbAccessToken}`
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
    // Don't log full pages data - contains access tokens
    if (process.env.NODE_ENV === 'development') {
      console.log('[instagram/callback] Page names:', pages.map((p: any) => p.name || p.id))
    }
    
    let igBusinessAccountId: string | null = null
    let pageId: string | null = null
    let pageAccessToken: string | null = null
    let pageName: string | null = null
    const pagesWithoutIG: string[] = []
    const debugInfo: any[] = []

    for (const page of pages) {
      // Try multiple fields to find Instagram account
      const igAccountUrl = `${buildMetaGraphUrl(`${page.id}`)}?fields=instagram_business_account,connected_instagram_account,instagram_accounts,name&access_token=${page.access_token}`
      const igAccountUrlWithProof = addAppSecretProofToUrl(igAccountUrl, page.access_token)
      
      try {
        const igAccountRes = await fetch(igAccountUrlWithProof)
        const igAccountData = await igAccountRes.json()
        
        // Only log in development, without sensitive data
        if (process.env.NODE_ENV === 'development') {
          console.log('[instagram/callback] Page', page.id, 'has IG account:', !!igAccountData.instagram_business_account?.id)
        }
        
        debugInfo.push({
          pageId: page.id,
          pageName: igAccountData.name,
          response: igAccountData,
          hasIgBusiness: !!igAccountData.instagram_business_account?.id,
          hasConnectedIg: !!igAccountData.connected_instagram_account?.id,
          error: igAccountData.error
        })
        
        if (igAccountRes.ok) {
          // Check multiple possible fields for Instagram account
          const igId = igAccountData.instagram_business_account?.id 
                    || igAccountData.connected_instagram_account?.id
                    || igAccountData.instagram_accounts?.data?.[0]?.id
          
          console.log('[instagram/callback] Page:', igAccountData.name, '- IG ID found:', igId || 'NONE')
          
          if (igId) {
            igBusinessAccountId = igId
            pageId = page.id
            pageAccessToken = page.access_token
            pageName = igAccountData.name
            console.log('[instagram/callback] ✅ Found Instagram Business on page:', pageName, 'ID:', igId)
            break // Found one, stop searching
          } else {
            pagesWithoutIG.push(igAccountData.name || page.id)
          }
        } else {
          console.error('[instagram/callback] API error for page', page.id, ':', igAccountData)
          pagesWithoutIG.push(`${page.name || page.id} (API Error: ${igAccountData.error?.message || 'Unknown'})`)
        }
      } catch (e) {
        console.warn('[instagram/callback] Error checking page', page.id, e)
        pagesWithoutIG.push(`${page.id} (Exception)`)
      }
    }
    
    // Log summary (without sensitive data)
    if (process.env.NODE_ENV === 'development') {
      console.log('[instagram/callback] Debug summary:', debugInfo.map(d => ({
        pageId: d.pageId,
        pageName: d.pageName,
        hasIgBusiness: d.hasIgBusiness,
        hasConnectedIg: d.hasConnectedIg,
        error: d.error?.message
      })))
    }

    // If not found via Page, try using the Instagram API directly with user token
    if (!igBusinessAccountId) {
      console.log('[instagram/callback] Trying alternative: Instagram API with user token...')
      try {
        // Try to get Instagram accounts directly from the user's connected accounts
        const igDirectUrl = `${buildMetaGraphUrl('me/accounts')}?fields=instagram_business_account{id,username,name},name,access_token&access_token=${fbAccessToken}`
        const igDirectRes = await fetch(igDirectUrl)
        const igDirectData = await igDirectRes.json()
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[instagram/callback] Direct IG query - pages found:', igDirectData?.data?.length || 0)
        }
        
        if (igDirectData.data) {
          for (const page of igDirectData.data) {
            if (page.instagram_business_account?.id) {
              igBusinessAccountId = page.instagram_business_account.id
              pageId = page.id
              pageAccessToken = page.access_token
              pageName = page.name
              console.log('[instagram/callback] ✅ Found via direct query:', pageName, 'IG ID:', igBusinessAccountId)
              
              debugInfo.push({
                method: 'direct_query',
                pageId: page.id,
                pageName: page.name,
                igBusinessAccountId,
                igUsername: page.instagram_business_account.username
              })
              break
            }
          }
        }
      } catch (e) {
        console.error('[instagram/callback] Direct IG query failed:', e)
      }
    }

    // Also try using me/instagram_accounts endpoint
    if (!igBusinessAccountId) {
      console.log('[instagram/callback] Trying alternative: /me/instagram_accounts...')
      try {
        const meIgUrl = `${buildMetaGraphUrl('me')}?fields=instagram_accounts{id,username}&access_token=${fbAccessToken}`
        const meIgRes = await fetch(meIgUrl)
        const meIgData = await meIgRes.json()
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[instagram/callback] /me/instagram_accounts - accounts found:', meIgData?.instagram_accounts?.data?.length || 0)
        }
        
        if (meIgData.instagram_accounts?.data?.[0]?.id) {
          // Found an IG account, now we need a page token
          igBusinessAccountId = meIgData.instagram_accounts.data[0].id
          // Use the first page's token if available
          if (pages.length > 0) {
            pageId = pages[0].id
            pageAccessToken = pages[0].access_token
            pageName = pages[0].name || 'Unknown Page'
          }
          console.log('[instagram/callback] ✅ Found via /me/instagram_accounts:', igBusinessAccountId)
          
          debugInfo.push({
            method: 'me_instagram_accounts',
            igBusinessAccountId,
            igUsername: meIgData.instagram_accounts.data[0].username
          })
        }
      } catch (e) {
        console.error('[instagram/callback] /me/instagram_accounts query failed:', e)
      }
    }

    if (!igBusinessAccountId || !pageId || !pageAccessToken) {
      const pagesList = pagesWithoutIG.length > 0 
        ? `<p><strong>Páginas encontradas sin Instagram Business:</strong></p><ul>${pagesWithoutIG.map(p => `<li>${p}</li>`).join('')}</ul>`
        : ''
      
      // Show sanitized debug info to help troubleshoot (no tokens or sensitive data)
      const sanitizedDebugInfo = debugInfo.map(d => ({
        pageId: d.pageId,
        pageName: d.pageName,
        hasIgBusiness: d.hasIgBusiness,
        hasConnectedIg: d.hasConnectedIg,
        method: d.method,
        error: d.error?.message || d.error
      }))
      const debugHtml = debugInfo.length > 0 
        ? `<details style="margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 5px;">
            <summary style="cursor: pointer; font-weight: bold;">🔍 Debug Info (click to expand)</summary>
            <pre style="overflow-x: auto; font-size: 11px; margin-top: 10px;">${JSON.stringify(sanitizedDebugInfo, null, 2)}</pre>
           </details>`
        : ''
      
      const html = `
        <html><body style="font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 20px;">
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
          
          <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px; border: 1px solid #ffc107;">
            <strong>⚠️ Posible causa:</strong> Es posible que el permiso <code>instagram_business_basic</code> necesite aprobación de Meta antes de poder ver cuentas de Instagram Business. 
            Verifica en tu <a href="https://developers.facebook.com/apps/${process.env.META_APP_ID}/app-review/permissions/" target="_blank">Meta Dashboard</a> si el permiso está aprobado.
          </div>
          
          ${debugHtml}
          <p style="margin-top: 20px;"><a href="/config/social">← Volver a configuración</a></p>
        </body></html>
      `
      return new NextResponse(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    // Subscribe the Page to this app for messaging webhooks (required for IG messaging delivery)
    try {
      const sub = await subscribePageToInstagramMessages(pageId, pageAccessToken)
      if (!sub.ok) {
        console.warn('[instagram/callback] Page subscribe failed', { 
          status: sub.status, 
          data: sub.data, 
          hasAppSecret: Boolean(process.env.META_APP_SECRET),
        })
      } else {
        console.log('[instagram/callback] Page subscribed to app', sub.data)
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
        <p>Ocurrió un error al conectar Instagram. Por favor intenta de nuevo.</p>
      </body></html>
    `
    return new NextResponse(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
}
