import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/tenants — list all managed tenant links with live order counts
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    // Hard-coded tenant IDs managed by logistics dashboard
    const MANAGED_TENANT_IDS = [
        'cmh32z0ol0000k004hvx9tg3p',
        'cmhsibjue0004js04gie724nx',
        'cmhutd1th0000jp04oqibtz54',
        'cmigornmw0000lb04kl75262e',
        'cmjdabz4d0000il04dyc5qmcc',
        'cmln5u7k70000ld042qify2og',
        'cmh44aerw0006vijg0640vfl0',
        'cmm4pv8fl0000jr045en1nik9',
    ];

    try {
        const tenants = await prisma.tenant.findMany({
            where: { id: { in: MANAGED_TENANT_IDS } },
            select: {
                id: true,
                name: true,
                slug: true,
                plan: true,
                isActive: true,
                businessName: true,
                ownerName: true,
                country: true,
                province: true,
                _count: {
                    select: { orders: true },
                },
            },
            orderBy: { name: 'asc' },
        });

        return NextResponse.json({ tenants });
    } catch (error) {
        console.error('[logistics/tenants] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch tenants' }, { status: 500 });
    }
}
