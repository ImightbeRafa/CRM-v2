import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { readProductionServerReadiness } from '@/lib/feature-flags';
import { groupStatusCounts } from '@/lib/production-query';
import { PII_NO_STORE_HEADERS } from '@/lib/security';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_production');
  if (!auth.ok) return auth.response;
  const readiness = await readProductionServerReadiness(auth.tenantId);
  const tenantPrisma = getTenantPrisma(auth.tenantId);
  if (!readiness.enabled) {
    const statuses = await tenantPrisma.orderStatus.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true, key: true, label: true, color: true, order: true, isActive: true },
    });
    return NextResponse.json({ status: 'success', data: { enabled: false, statuses } }, { headers: PII_NO_STORE_HEADERS });
  }
  try {
    if (readiness.terminalFilteringEnabled) {
      await tenantPrisma.tenantOrderStatusClassification.count({ where: {} });
    }
    const [statuses, rawCounts] = await Promise.all([
      tenantPrisma.orderStatus.findMany({
        where: { isActive: true },
        orderBy: { order: 'asc' },
        select: { id: true, key: true, label: true, color: true, order: true, isActive: true },
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: { tenantId: auth.tenantId },
        _count: { _all: true },
      }),
    ]);
    const grouped = groupStatusCounts(rawCounts, statuses);
    return NextResponse.json({
      status: 'success',
      data: {
        enabled: true,
        statuses: statuses.map((status: { id: string; key: string; label: string; color: string | null; order: number; isActive: boolean }) => ({
          ...status,
          count: grouped.counts[status.id] || 0,
        })),
        unconfiguredCount: grouped.unconfigured,
        terminalFilteringEnabled: readiness.terminalFilteringEnabled,
        mappingRevision: readiness.mappingRevision,
      },
    }, { headers: PII_NO_STORE_HEADERS });
  } catch (error) {
    console.error('[production/metadata] Feature schema unavailable:', error instanceof Error ? error.message : 'unknown');
    const statuses = await tenantPrisma.orderStatus.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true, key: true, label: true, color: true, order: true, isActive: true },
    }).catch(() => []);
    return NextResponse.json({ status: 'success', data: { enabled: false, reason: 'schema_pending', statuses } }, { headers: PII_NO_STORE_HEADERS });
  }
}
