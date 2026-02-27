import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


const MANAGED_TENANTS = [
    { id: 'cmh32z0ol0000k004hvx9tg3p', defaultName: 'WhatASheet CR', defaultColor: '#6c63ff' },
    { id: 'cmhsibjue0004js04gie724nx', defaultName: 'DeepSleep', defaultColor: '#3b82f6' },
    { id: 'cmhutd1th0000jp04oqibtz54', defaultName: 'WAS CR', defaultColor: '#22c55e' },
    { id: 'cmigornmw0000lb04kl75262e', defaultName: 'Kroma Lab', defaultColor: '#f59e0b' },
    { id: 'cmjdabz4d0000il04dyc5qmcc', defaultName: 'SimplePatch', defaultColor: '#ef4444' },
    { id: 'cmln5u7k70000ld042qify2og', defaultName: 'DeepCLean', defaultColor: '#a855f7' },
    { id: 'cmh44aerw0006vijg0640vfl0', defaultName: 'PeterTesting', defaultColor: '#06b6d4' },
    { id: 'cmm4pv8fl0000jr045en1nik9', defaultName: 'Bloom', defaultColor: '#ec4899' },
];

// GET /api/logistics/tenant-config — returns display config for all managed tenants
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key LIKE 'tenant_%'
        `;

        const config: Record<string, string> = {};
        for (const row of rows) { config[row.key] = row.value; }

        const tenants = MANAGED_TENANTS.map(t => ({
            id: t.id,
            name: config[`tenant_name_${t.id}`] ?? t.defaultName,
            color: config[`tenant_color_${t.id}`] ?? t.defaultColor,
            defaultName: t.defaultName,
            defaultColor: t.defaultColor,
        }));

        return NextResponse.json({ tenants }, {
            headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
        });
    } catch {
        return NextResponse.json({ tenants: MANAGED_TENANTS.map(t => ({ id: t.id, name: t.defaultName, color: t.defaultColor, defaultName: t.defaultName, defaultColor: t.defaultColor })) });
    }
}

// PATCH /api/logistics/tenant-config — upsert name or color for a tenant
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { tenantId, name, color } = body;

    if (!tenantId || (!name && !color)) {
        return NextResponse.json({ error: 'tenantId and at least one of name/color required' }, { status: 400 });
    }

    const validIds = MANAGED_TENANTS.map(t => t.id);
    if (!validIds.includes(tenantId)) {
        return NextResponse.json({ error: 'Invalid tenantId' }, { status: 400 });
    }

    try {
        if (name !== undefined) {
            const k = `tenant_name_${tenantId}`;
            await prisma.$executeRaw`INSERT INTO lm_carrier_configs (key, value) VALUES (${k}, ${name}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
        }
        if (color !== undefined) {
            const k = `tenant_color_${tenantId}`;
            await prisma.$executeRaw`INSERT INTO lm_carrier_configs (key, value) VALUES (${k}, ${color}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
        }
        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('[tenant-config PATCH]', e);
        return NextResponse.json({ error: 'Failed to save tenant config' }, { status: 500 });
    }
}
