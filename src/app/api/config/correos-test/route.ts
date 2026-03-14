import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/config/correos-test
 *
 * Tenant-scoped Correos CR connection test.
 * Accepts credentials in the request body (not yet saved)
 * so users can test before committing.
 */
export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const role = (token as any).currentTenant?.role || (token as any).membershipRole;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const settings = body.settings;

    if (!settings?.ws_username || !settings?.ws_password) {
      return NextResponse.json(
        { success: false, error: 'Se requieren usuario y contraseña del Web Service.' },
        { status: 400 }
      );
    }

    const creds: CorreosWSCredentials = {
      username: settings.ws_username,
      password: settings.ws_password,
      sistema: settings.ws_sistema || 'PYMEXPRESS',
      usuarioId: Number(settings.ws_usuario_id) || 0,
      servicioId: Number(settings.ws_servicio_id) || 0,
      codCliente: settings.ws_cod_cliente || '',
    };

    const ws = new CorreosWebService(creds);

    await ws.getSoapClient().getTokenManager().getToken();

    const prov = await ws.getSoapClient().getProvincias();
    const provinceCount = prov.Provincias?.length ?? 0;

    if (prov.CodRespuesta !== '00') {
      return NextResponse.json({
        success: false,
        error: `Correos respondió con código ${prov.CodRespuesta}`,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Conexión exitosa. ${provinceCount} provincias encontradas.`,
    });
  } catch (e: any) {
    const message = e.message || 'Error de conexión desconocido';
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
