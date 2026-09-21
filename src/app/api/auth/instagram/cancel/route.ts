import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Instagram OAuth cancel/deauthorize callback.
 * Requires update_config so cancel cannot be used anonymously to probe the flow.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) {
    return new NextResponse(
      `<html lang="es"><body style="font-family:sans-serif;text-align:center;margin-top:4rem">
        <h2>No autorizado</h2>
        <p>Iniciá sesión con permisos de configuración para gestionar Instagram.</p>
      </body></html>`,
      { status: auth.response.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

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
