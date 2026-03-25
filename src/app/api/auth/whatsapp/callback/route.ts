import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/whatsapp/callback
 * This endpoint is used as the redirect_uri for WhatsApp Embedded Signup.
 * It does not need to process anything; it simply renders a small page so the popup can be closed.
 */
export async function GET() {
  const html = `<!doctype html>
  <html>
    <head><meta charset="utf-8"><title>WhatsApp Connected</title></head>
    <body style="font-family:system-ui,sans-serif;padding:24px;">
      <h2>Continuar en Betsy</h2>
      <p>Se completó el inicio con Facebook. Puedes cerrar esta ventana.</p>
      <script>
        // Optionally notify opener
        try { if (window.opener) window.opener.postMessage(JSON.stringify({ source:'betsy',event:'wa_oauth_complete' }), window.location.origin) } catch {}
        setTimeout(() => { window.close() }, 500)
      </script>
    </body>
  </html>`
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
