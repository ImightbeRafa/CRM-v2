import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

const MANAGED_TENANT_IDS = [
    'cmh32z0ol0000k004hvx9tg3p',
    'cmhsibjue0004js04gie724nx',
    'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e',
    'cmjdabz4d0000il04dyc5qmcc',
    'cmln5u7k70000ld042qify2og',
    'cmh44aerw0006vijg0640vfl0',
];

// GET /api/logistics/stats
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const url = new URL(req.url);
        const tenantId = url.searchParams.get('tenantId');
        const tenantFilter = tenantId
            ? { tenantId }
            : { tenantId: { in: MANAGED_TENANT_IDS } };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [total, todayCount, byStatus, byTenant] = await Promise.all([
            // Total orders across managed tenants
            prisma.order.count({ where: tenantFilter }),

            // Orders created today
            prisma.order.count({
                where: { ...tenantFilter, timestamp: { gte: today } },
            }),

            // By status
            prisma.order.groupBy({
                by: ['status'],
                where: tenantFilter,
                _count: { id: true },
                orderBy: { _count: { id: 'desc' } },
            }),

            // By tenant
            prisma.order.groupBy({
                by: ['tenantId'],
                where: { tenantId: { in: MANAGED_TENANT_IDS } },
                _count: { id: true },
            }),
        ]);

        return NextResponse.json({
            total,
            today: todayCount,
            byStatus: byStatus.map(s => ({ status: s.status, count: s._count.id })),
            byTenant: byTenant.map(t => ({ tenantId: t.tenantId, count: t._count.id })),
        });
    } catch (error) {
        console.error('[logistics/stats] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
