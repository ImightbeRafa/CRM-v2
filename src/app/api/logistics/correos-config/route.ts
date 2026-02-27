import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BROWSER_KEYS = ['correos_email', 'correos_password'] as const;
const WS_KEYS = [
    'correos_ws_username',
    'correos_ws_password',
    'correos_ws_sistema',
    'correos_ws_usuario_id',
    'correos_ws_servicio_id',
    'correos_ws_cod_cliente',
    'correos_integration_mode',
] as const;
const ALL_KEYS = [...BROWSER_KEYS, ...WS_KEYS] as const;

// GET /api/logistics/correos-config — returns all Correos credentials
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN (${ALL_KEYS[0]}, ${ALL_KEYS[1]}, ${ALL_KEYS[2]}, ${ALL_KEYS[3]}, ${ALL_KEYS[4]}, ${ALL_KEYS[5]}, ${ALL_KEYS[6]}, ${ALL_KEYS[7]}, ${ALL_KEYS[8]})
        `;

        const config: Record<string, string> = {};
        for (const row of rows) config[row.key] = row.value;

        return NextResponse.json({
            // Browser automation creds
            email: config.correos_email || '',
            password: config.correos_password ? '••••••••' : '',
            hasCredentials: !!(config.correos_email && config.correos_password),
            // Web Service creds
            ws_username: config.correos_ws_username || '',
            ws_password: config.correos_ws_password ? '••••••••' : '',
            ws_sistema: config.correos_ws_sistema || '',
            ws_usuario_id: config.correos_ws_usuario_id || '',
            ws_servicio_id: config.correos_ws_servicio_id || '',
            ws_cod_cliente: config.correos_ws_cod_cliente || '',
            hasWsCredentials: !!(config.correos_ws_username && config.correos_ws_password),
            // Integration mode
            integrationMode: config.correos_integration_mode || 'browser',
        });
    } catch (e) {
        console.error('[logistics/correos-config GET]', e);
        return NextResponse.json({ email: '', password: '', hasCredentials: false, hasWsCredentials: false, integrationMode: 'browser' });
    }
}

async function upsertConfig(key: string, value: string, description: string) {
    await prisma.$executeRaw`
        INSERT INTO lm_carrier_configs (carrier, key, value, description)
        VALUES ('correos', ${key}, ${value}, ${description})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
}

// PATCH /api/logistics/correos-config — upsert Correos credentials (browser + WS)
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();

    try {
        // Browser automation credentials
        if (body.email) await upsertConfig('correos_email', body.email, 'Correos browser automation login email');
        if (body.password) await upsertConfig('correos_password', body.password, 'Correos browser automation login password');

        // Web Service credentials
        if (body.ws_username) await upsertConfig('correos_ws_username', body.ws_username, 'Correos WS API username');
        if (body.ws_password) await upsertConfig('correos_ws_password', body.ws_password, 'Correos WS API password');
        if (body.ws_sistema) await upsertConfig('correos_ws_sistema', body.ws_sistema, 'Correos WS system identifier');
        if (body.ws_usuario_id) await upsertConfig('correos_ws_usuario_id', String(body.ws_usuario_id), 'Correos WS user ID');
        if (body.ws_servicio_id) await upsertConfig('correos_ws_servicio_id', String(body.ws_servicio_id), 'Correos WS service ID');
        if (body.ws_cod_cliente) await upsertConfig('correos_ws_cod_cliente', body.ws_cod_cliente, 'Correos WS client code');
        if (body.integrationMode) await upsertConfig('correos_integration_mode', body.integrationMode, 'Integration mode: webservice or browser');

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('[logistics/correos-config PATCH]', e);
        return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
    }
}
