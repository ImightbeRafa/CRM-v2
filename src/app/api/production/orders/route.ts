import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { readProductionServerReadiness } from '@/lib/feature-flags';
import { decodeTimestampCursor, encodeTimestampCursor, parsePageLimit } from '@/lib/cursor-pagination';
import { buildProductionWhere, parseProductionQuery, productionCursorScope } from '@/lib/production-query';
import { PRODUCTION_LIST_DEFAULT_LIMIT } from '@/lib/statistics-period-query';
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
    const { searchParams } = new URL(request.url);
    const input = parseProductionQuery(searchParams);
    // Default list = 100 most recently updated (SQL take). Search filters in WHERE first,
    // so older matches still appear — never "last 100 then client-filter".
    const limit = parsePageLimit(
      searchParams.get('limit'),
      input.view === 'column' ? 20 : PRODUCTION_LIST_DEFAULT_LIMIT,
    );
    const tenantPrisma = getTenantPrisma(auth.tenantId);
    const statuses = await tenantPrisma.orderStatus.findMany({
      where: { isActive: true },
      select: { id: true, label: true },
      orderBy: { order: 'asc' },
    });
    const selectedStatus = input.statusId
      ? statuses.find(status => status.id === input.statusId) || null
      : null;
    if (input.statusId && !selectedStatus) {
      return NextResponse.json({ error: 'Unknown or inactive status' }, { status: 400, headers: PII_NO_STORE_HEADERS });
    }
    const classifications = readiness.terminalFilteringEnabled
      ? await tenantPrisma.tenantOrderStatusClassification.findMany({
          where: {},
          select: { statusValue: true, isTerminal: true },
        })
      : [];
    const baseWhere = buildProductionWhere({
      input,
      configuredStatuses: statuses,
      selectedStatus,
      terminalClassifications: classifications,
      terminalFilteringEnabled: readiness.terminalFilteringEnabled,
    });
    const scope = productionCursorScope(input, selectedStatus, readiness.mappingRevision);
    const cursor = decodeTimestampCursor(searchParams.get('cursor'), scope);
    // Cursor payload "timestamp" field carries updatedAt ISO for updatedAt DESC paging.
    const where = cursor
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { updatedAt: { lt: new Date(cursor.timestamp) } },
                { updatedAt: new Date(cursor.timestamp), id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : baseWhere;
    const [rows, totalCount] = await Promise.all([
      tenantPrisma.order.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true, orderId: true, orderType: true, status: true, timestamp: true, updatedAt: true,
          customerName: true, username: true, phone: true, email: true, business: true,
          product: true, quantity: true, size: true, color: true, packaging: true,
          customization: true, comments: true, total: true, iva: true, shippingCost: true,
          productCost: true, address: true, province: true, canton: true, district: true,
          courier: true, expectedDate: true, funnel: true, agreedDate: true, pickupDate: true,
          saleDate: true, seller: true, delivery: true, customFields: true, contraEntrega: true,
          cePaymentConfirmed: true, tenantId: true,
        },
      }),
      tenantPrisma.order.count({ where: baseWhere }),
    ]);
    if (process.env.NODE_ENV !== 'production') {
      const leaked = rows.filter((row) => row.tenantId !== auth.tenantId);
      if (leaked.length > 0) {
        console.error('CRITICAL TENANT ISOLATION BREACH in /api/production/orders:', {
          requestedTenant: auth.tenantId,
          breached: leaked.map((row) => ({ orderId: row.orderId, tenantId: row.tenantId })),
        });
      }
    }
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map(({ tenantId: _tenantId, ...order }) => order);
    const last = pageRows.at(-1);
    return NextResponse.json({
      status: 'success',
      data: {
        items,
        pageInfo: {
          hasMore,
          nextCursor: hasMore && last
            ? encodeTimestampCursor({ timestamp: last.updatedAt.toISOString(), id: last.id }, scope)
            : null,
        },
        totalCount,
        retentionMode: readiness.terminalFilteringEnabled ? 'open_plus_30_terminal' : 'all',
        asOf: new Date().toISOString(),
      },
    }, { headers: PII_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid production query';
    const clientError = /Invalid|require|between|at least|Column/.test(message);
    if (!clientError) console.error('[production/orders]', message);
    return NextResponse.json({ error: clientError ? message : 'Failed to load production orders' }, {
      status: clientError ? 400 : 500,
      headers: PII_NO_STORE_HEADERS,
    });
  }
}
