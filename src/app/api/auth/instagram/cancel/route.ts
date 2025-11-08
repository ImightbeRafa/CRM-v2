import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Instagram OAuth cancel/deauthorize callback
 * Simple HTML page informing the user the login was canceled.
 */
export async function GET() {
  const html = `
    <html lang="es">
    <head><meta charset="utf-8"><title>Inicio de sesión cancelado</title></head>
    <body style="font-family: sans-serif; text-align:center; margin-top: 4rem;">
      <h2>Inicio de sesión cancelado</h2>
      <p>Has cancelado la conexión con Instagram.</p>
      <p>Puedes cerrar esta ventana y volver a la aplicación.</p>
    </body>
    </html>
  `
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
