import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { CorreosWebService } from '@/lib/correos';
import { getCorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/config/correos-test
 *
 * Tests the platform-level Correos CR SOAP connection using
 * credentials from environment variables.
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

    let creds;
    try {
      creds = getCorreosWSCredentials();
    } catch (e: any) {
      return NextResponse.json({
        success: false,
        error: e.message || 'Correos WS platform credentials not configured.',
      });
    }

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
