import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/logistics/tarifa
 *
 * Queries Correos de Costa Rica for a shipping rate (ccrTarifa).
 *
 * Body: { provinciaOrigen, cantonOrigen, provinciaDestino, cantonDestino, peso }
 * All fields accept location *names*; codes are resolved automatically.
 */
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const body = await req.json();
        const { provinciaOrigen, cantonOrigen, distritoOrigen, provinciaDestino, cantonDestino, distritoDestino, peso } = body;

        const locationFields = { provinciaOrigen, cantonOrigen, distritoOrigen, provinciaDestino, cantonDestino, distritoDestino };
        for (const [key, val] of Object.entries(locationFields)) {
            if (!val || typeof val !== 'string' || val.length > 100) {
                return NextResponse.json({ error: `Invalid or missing field: ${key}` }, { status: 400 });
            }
        }

        const numPeso = Number(peso);
        if (!Number.isFinite(numPeso) || numPeso <= 0 || numPeso > 100_000) {
            return NextResponse.json({ error: 'peso must be a positive number (max 100000g)' }, { status: 400 });
        }

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
        const result = await ws.getRate({
            provinciaOrigen,
            cantonOrigen,
            distritoOrigen,
            provinciaDestino,
            cantonDestino,
            distritoDestino,
            peso: numPeso,
        });

        return NextResponse.json(result);
    } catch (e: any) {
        console.error('[logistics/tarifa]', e);
        return NextResponse.json({ success: false, error: 'Rate quote request failed. Please try again.' }, { status: 500 });
    }
}
