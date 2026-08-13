import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { MANAGED_TENANT_IDS } from '@/lib/logistics-managed-tenants';

// GET /api/logistics/tenants — list all managed tenant links with live order counts
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

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
