import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { readProductionServerReadiness } from '@/lib/feature-flags';
import { buildProductionWhere, parseProductionQuery } from '@/lib/production-query';
import { PII_NO_STORE_HEADERS } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_production');
  if (!auth.ok) return auth.response;
  const readiness = await readProductionServerReadiness(auth.tenantId);
  if (!readiness.enabled) {
    return NextResponse.json({ error: 'Feature disabled', code: 'FEATURE_DISABLED' }, { status: 409, headers: PII_NO_STORE_HEADERS });
  }
  try {
    const input = parseProductionQuery(new URL(request.url).searchParams);
    input.view = 'list';
    input.statusId = null;
    input.column = null;
    input.orderType = null;
    input.priority = null;
    const tenantPrisma = getTenantPrisma(auth.tenantId);
    const [statuses, classifications] = await Promise.all([
      tenantPrisma.orderStatus.findMany({ where: { isActive: true }, select: { id: true, label: true } }),
      readiness.terminalFilteringEnabled
        ? tenantPrisma.tenantOrderStatusClassification.findMany({ where: {}, select: { statusValue: true, isTerminal: true } })
        : Promise.resolve([]),
    ]);
    const where = buildProductionWhere({
      input,
      configuredStatuses: statuses,
      selectedStatus: null,
      terminalClassifications: classifications,
      terminalFilteringEnabled: readiness.terminalFilteringEnabled,
    });
    const urgentBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [aggregate, eaOrders, raOrders, urgentOrders] = await Promise.all([
      tenantPrisma.order.aggregate({ where, _count: { _all: true }, _sum: { total: true } }),
      tenantPrisma.order.count({ where: { AND: [where, { orderType: 'EA' }] } }),
      tenantPrisma.order.count({ where: { AND: [where, { orderType: 'RA' }] } }),
      tenantPrisma.order.count({
        where: {
          AND: [
            where,
            {
              OR: [
                { status: { in: ['urgent', 'urgente'], mode: 'insensitive' } },
                { status: { equals: 'Pendiente', mode: 'insensitive' }, timestamp: { lt: urgentBefore } },
              ],
            },
          ],
        },
      }),
    ]);
    return NextResponse.json({
      status: 'success',
      data: {
        total: aggregate._count._all,
        eaOrders,
        raOrders,
        urgentOrders,
        totalAmount: aggregate._sum.total || 0,
        asOf: new Date().toISOString(),
      },
    }, { headers: PII_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid production query';
    const clientError = /Invalid|at least/.test(message);
    if (!clientError) console.error('[production/summary]', message);
    return NextResponse.json({ error: clientError ? message : 'Failed to load production summary' }, {
      status: clientError ? 400 : 500,
      headers: PII_NO_STORE_HEADERS,
    });
  }
}
