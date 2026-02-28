import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/tracking?envioId=XX
 *
 * Queries Correos de Costa Rica tracking (ccrMovilTracking) for a given guía number.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const envioId = req.nextUrl.searchParams.get('envioId')?.trim();
    if (!envioId || envioId.length > 30 || !/^[A-Za-z0-9-]+$/.test(envioId)) {
        return NextResponse.json({ error: 'envioId must be a valid tracking number (alphanumeric, max 30 chars)' }, { status: 400 });
    }

    try {
        const credRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key LIKE 'correos_ws_%'
        `;
        const cfg: Record<string, string> = {};
        for (const row of credRows) cfg[row.key] = row.value;

        if (!cfg.correos_ws_username || !cfg.correos_ws_password) {
            return NextResponse.json(
                { error: 'Correos Web Service credentials not configured.' },
                { status: 400 }
            );
        }

        const wsCreds: CorreosWSCredentials = {
            username: cfg.correos_ws_username,
            password: cfg.correos_ws_password,
            sistema: cfg.correos_ws_sistema || 'PYMEXPRESS',
            usuarioId: Number(cfg.correos_ws_usuario_id) || 0,
            servicioId: Number(cfg.correos_ws_servicio_id) || 0,
            codCliente: cfg.correos_ws_cod_cliente || '',
        };

        const ws = new CorreosWebService(wsCreds);
        const result = await ws.trackShipment(envioId);

        return NextResponse.json(result);
    } catch (e: any) {
        console.error('[logistics/tracking]', e);
        return NextResponse.json({ success: false, error: 'Tracking request failed. Please try again.' }, { status: 500 });
    }
}
