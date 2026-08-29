import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { CorreosWebService, resolveCorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/config/correos-test
 *
 * Token + read-only province lookup using the same credential resolver as
 * tenant guía generation (logistics DB first, env fallback).
 */
export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const role = (token as { currentTenant?: { role?: string }; membershipRole?: string }).currentTenant?.role
      || (token as { membershipRole?: string }).membershipRole;
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    let resolved;
    try {
      resolved = await resolveCorreosWSCredentials();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Correos WS credentials are not configured.';
      return NextResponse.json({
        success: false,
        error: message,
      });
    }

    const ws = new CorreosWebService(resolved.credentials);

    await ws.getSoapClient().getTokenManager().getToken();

    const prov = await ws.getSoapClient().getProvincias();
    const provinceCount = prov.Provincias?.length ?? 0;

    if (prov.CodRespuesta !== '00') {
      return NextResponse.json({
        success: false,
        source: resolved.source,
        error: `Correos respondió con código ${prov.CodRespuesta}`,
      });
    }

    return NextResponse.json({
      success: true,
      source: resolved.source,
      message: `Conexión exitosa. ${provinceCount} provincias encontradas.`,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Error de conexión desconocido';
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
