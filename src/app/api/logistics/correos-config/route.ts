import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/logistics/correos-config — returns all Correos WS credentials + sender info
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key LIKE 'correos_ws_%'
        `;

        const config: Record<string, string> = {};
        for (const row of rows) config[row.key] = row.value;

        return NextResponse.json({
            ws_username: config.correos_ws_username || '',
            ws_password: config.correos_ws_password ? '••••••••' : '',
            ws_sistema: config.correos_ws_sistema || '',
            ws_usuario_id: config.correos_ws_usuario_id || '',
            ws_servicio_id: config.correos_ws_servicio_id || '',
            ws_cod_cliente: config.correos_ws_cod_cliente || '',
            hasWsCredentials: !!(config.correos_ws_username && config.correos_ws_password),
            ws_sender_name: config.correos_ws_sender_name || '',
            ws_sender_address: config.correos_ws_sender_address || '',
            ws_sender_zip: config.correos_ws_sender_zip || '',
            ws_sender_phone: config.correos_ws_sender_phone || '',
        });
    } catch (e) {
        console.error('[logistics/correos-config GET]', e);
        return NextResponse.json({ hasWsCredentials: false });
    }
}

async function upsertConfig(key: string, value: string, description: string) {
    await prisma.$executeRaw`
        INSERT INTO lm_carrier_configs (carrier, key, value, description)
        VALUES ('correos', ${key}, ${value}, ${description})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
}

// PATCH /api/logistics/correos-config — upsert Correos WS credentials + sender info
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();

    try {
        if (body.ws_username) await upsertConfig('correos_ws_username', body.ws_username, 'Correos WS API username');
        if (body.ws_password) await upsertConfig('correos_ws_password', body.ws_password, 'Correos WS API password');
        if (body.ws_sistema) await upsertConfig('correos_ws_sistema', body.ws_sistema, 'Correos WS system identifier');
        if (body.ws_usuario_id) await upsertConfig('correos_ws_usuario_id', String(body.ws_usuario_id), 'Correos WS user ID');
        if (body.ws_servicio_id) await upsertConfig('correos_ws_servicio_id', String(body.ws_servicio_id), 'Correos WS service ID');
        if (body.ws_cod_cliente) await upsertConfig('correos_ws_cod_cliente', body.ws_cod_cliente, 'Correos WS client code');
        if (body.ws_sender_name !== undefined) await upsertConfig('correos_ws_sender_name', body.ws_sender_name, 'Sender name on guía');
        if (body.ws_sender_address !== undefined) await upsertConfig('correos_ws_sender_address', body.ws_sender_address, 'Sender address on guía');
        if (body.ws_sender_zip !== undefined) await upsertConfig('correos_ws_sender_zip', body.ws_sender_zip, 'Sender postal code on guía');
        if (body.ws_sender_phone !== undefined) await upsertConfig('correos_ws_sender_phone', body.ws_sender_phone, 'Sender phone on guía');

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('[logistics/correos-config PATCH]', e);
        return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
    }
}
