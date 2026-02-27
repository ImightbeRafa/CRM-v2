import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORREOS_KEYS = ['correos_email', 'correos_password'] as const;

// GET /api/logistics/correos-config — returns the global Correos credentials
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN ('correos_email', 'correos_password')
        `;

        const config: Record<string, string> = {};
        for (const row of rows) {
            config[row.key] = row.value;
        }

        return NextResponse.json({
            email: config.correos_email || '',
            password: config.correos_password ? '••••••••' : '',
            hasCredentials: !!(config.correos_email && config.correos_password),
        });
    } catch (e) {
        console.error('[logistics/correos-config GET]', e);
        return NextResponse.json({ email: '', password: '', hasCredentials: false });
    }
}

// PATCH /api/logistics/correos-config — upsert Correos credentials
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { email, password } = body;

    if (!email && !password) {
        return NextResponse.json({ error: 'Provide email and/or password' }, { status: 400 });
    }

    try {
        if (email) {
            await prisma.$executeRaw`
                INSERT INTO lm_carrier_configs (carrier, key, value, description)
                VALUES ('correos', 'correos_email', ${email}, 'Global Correos de Costa Rica login email')
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `;
        }

        if (password) {
            await prisma.$executeRaw`
                INSERT INTO lm_carrier_configs (carrier, key, value, description)
                VALUES ('correos', 'correos_password', ${password}, 'Global Correos de Costa Rica login password')
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `;
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('[logistics/correos-config PATCH]', e);
        return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
    }
}
