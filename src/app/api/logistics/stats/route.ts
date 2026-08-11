import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
    MANAGED_TENANT_IDS,
    resolveManagedTenantFilter,
} from '@/lib/logistics-managed-tenants';

// GET /api/logistics/stats
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const url = new URL(req.url);
        const tenantId = url.searchParams.get('tenantId');
        const resolved = resolveManagedTenantFilter(tenantId);
        if (!resolved.ok) {
            return NextResponse.json({ error: 'Tenant not in managed allowlist' }, { status: 403 });
        }
        const tenantFilter = { tenantId: resolved.tenantId };

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
