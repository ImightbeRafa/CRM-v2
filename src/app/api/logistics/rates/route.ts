import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


// Default rates used for seeding
const DEFAULTS: Record<string, number> = {
    mensajeria_rate: 2600,
    correos_rate: 2500,
    handling_rate: 600,
};

// GET /api/logistics/rates — returns the three flat rates
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN ('mensajeria_rate', 'correos_rate', 'handling_rate')
        `;

        const rates: Record<string, number> = { ...DEFAULTS };
        for (const row of rows) { rates[row.key] = Number(row.value); }
        return NextResponse.json({ rates }, {
            headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
        });
    } catch {
        return NextResponse.json({ rates: DEFAULTS });
    }
}

// PATCH /api/logistics/rates — upsert a rate
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { key, value } = body;

    const allowed = ['mensajeria_rate', 'correos_rate', 'handling_rate'];
    if (!key || !allowed.includes(key)) {
        return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }
    const num = Number(value);
    if (isNaN(num) || num < 0) {
        return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 });
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO lm_carrier_configs (key, value)
            VALUES (${key}, ${String(num)})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
        return NextResponse.json({ success: true, key, value: num });
    } catch (e) {
        console.error('[logistics/rates PATCH]', e);
        return NextResponse.json({ error: 'Failed to save rate' }, { status: 500 });
    }
}
