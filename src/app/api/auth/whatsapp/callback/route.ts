import { NextRequest, NextResponse } from 'next/server'
import {
  isValidWaDirectOauthState,
  WA_DIRECT_OAUTH_STATE_COOKIE,
} from '@/lib/wa-direct-oauth-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/whatsapp/callback
 * Redirect URI for WhatsApp direct OAuth fallback.
 * Validates CSRF `state` against the HttpOnly cookie set by direct-oauth,
 * then renders a tiny page so the popup can hand the code back and close.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const stateParam = url.searchParams.get('state') || ''
  const storedState = request.cookies.get(WA_DIRECT_OAUTH_STATE_COOKIE)?.value || ''
  const code = url.searchParams.get('code') || ''
  const oauthError = url.searchParams.get('error')

  if (!isValidWaDirectOauthState(stateParam, storedState)) {
    const denied = NextResponse.json(
      { error: 'Invalid OAuth state — possible CSRF attack' },
      { status: 403 },
    )
    denied.cookies.set(WA_DIRECT_OAUTH_STATE_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    return denied
  }

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>WhatsApp conectado</title>
  </head>
  <body>
    <script>
      (function () {
        var payload = {
          type: 'wa_direct_oauth',
          ok: ${oauthError ? 'false' : 'true'},
          code: ${JSON.stringify(code)},
          error: ${JSON.stringify(oauthError || '')},
        };
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
          }
        } catch (e) {}
        window.close();
      })();
    </script>
    <p>Podés cerrar esta ventana.</p>
  </body>
</html>`

  const response = new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
  response.cookies.set(WA_DIRECT_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return response
}
