import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';
import { getCorreosV3ForRead } from '@/lib/correos/v3/select';
import { SHIPMENT_STATUS_LABEL, classifyStatus } from '@/lib/correos/v3/mappers';
import { getEvents } from '@/lib/correos/v3/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/tracking?envioId=XX
 *
 * Correos de Costa Rica tracking for a guía number. Correos API v3 when it is on
 * (GPS, delivered date, who received), SOAP ccrMovilTracking otherwise / as fallback.
 * Answer: { success, live, api, tracking: { guiaNumber, status, statusLabel, statusText, deliveredAt, deliveredTo, events[] } }
 * plus the legacy SOAP fields (header, events) when SOAP answered.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const envioId = req.nextUrl.searchParams.get('envioId')?.trim();
    if (!envioId || envioId.length > 30 || !/^[A-Za-z0-9-]+$/.test(envioId)) {
        return NextResponse.json({ error: 'envioId must be a valid tracking number (alphanumeric, max 30 chars)' }, { status: 400 });
    }

    const v3 = await getCorreosV3ForRead().catch(() => null);
    if (v3) {
        try {
            const t = await v3.track(envioId);
            return NextResponse.json({ success: true, live: true, api: 'v3', tracking: { ...t, statusLabel: SHIPMENT_STATUS_LABEL[t.status] } });
        } catch (e) {
            console.warn('[logistics/tracking] v3 failed, trying SOAP:', e instanceof Error ? e.message : e);
        }
    }

    try {
        const credRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key LIKE 'correos_ws_%'
        `;
        const cfg: Record<string, string> = {};
        for (const row of credRows) cfg[row.key] = row.value;

        if (!cfg.correos_ws_username || !cfg.correos_ws_password) {
            const stored = await getEvents(null, envioId);
            if (stored.length) return NextResponse.json(storedAnswer(envioId, stored));
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
        const events = (result.events || []).map((e) => ({
            at: e.FechaHora || null, code: null, description: e.Evento || 'Movimiento', place: e.Unidad || null,
            receivedBy: e.RecibidoPor || null, lat: null, lng: null,
        }));
        const status = classifyStatus(result.header?.Estado || events.at(-1)?.description);
        return NextResponse.json({
            ...result,
            live: true,
            api: 'soap',
            tracking: {
                guiaNumber: envioId, status, statusLabel: SHIPMENT_STATUS_LABEL[status], statusText: result.header?.Estado ?? null,
                deliveredAt: null, deliveredTo: null, events,
            },
        });
    } catch (e: any) {
        console.error('[logistics/tracking]', e);
        return NextResponse.json({ success: false, error: 'Tracking request failed. Please try again.' }, { status: 500 });
    }
}

function storedAnswer(envioId: string, stored: Awaited<ReturnType<typeof getEvents>>) {
    return {
        success: true,
        live: false,
        api: 'stored',
        tracking: {
            guiaNumber: envioId,
            events: stored.map((ev) => ({ at: ev.event_at, code: ev.codigo, description: ev.descripcion, place: ev.ubicacion, receivedBy: ev.recibido_por, lat: ev.lat, lng: ev.lng })),
        },
    };
}
