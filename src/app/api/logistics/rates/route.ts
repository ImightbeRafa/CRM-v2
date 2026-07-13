import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getLogisticsRates, LOGISTICS_RATE_DEFAULTS, LOGISTICS_RATE_KEYS } from '@/lib/logistics-rates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/logistics/rates
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const rates = await getLogisticsRates();
        return NextResponse.json({ rates }, {
            headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
        });
    } catch {
        return NextResponse.json({ rates: LOGISTICS_RATE_DEFAULTS });
    }
}

// PATCH /api/logistics/rates
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { key, value } = body;

    if (!key || !LOGISTICS_RATE_KEYS.includes(key)) {
        return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
    }

    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
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
