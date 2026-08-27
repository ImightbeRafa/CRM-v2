import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { readClientsServerReadiness } from '@/lib/feature-flags';
import { decodeTimestampCursor, encodeTimestampCursor, hashCursorScope, parsePageLimit } from '@/lib/cursor-pagination';
import { PII_NO_STORE_HEADERS } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAPIWithPermission(request, 'view_sales');
  if (!auth.ok) return auth.response;
  const readiness = await readClientsServerReadiness(auth.tenantId);
  if (!readiness.enabled) {
    return NextResponse.json({ error: 'Client history is not ready', code: 'BACKFILL_REQUIRED' }, { status: 409, headers: PII_NO_STORE_HEADERS });
  }
  try {
    const { id } = await context.params;
    const tenantPrisma = getTenantPrisma(auth.tenantId);
    const client = await tenantPrisma.client.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: PII_NO_STORE_HEADERS });
    const { searchParams } = new URL(request.url);
    const limit = parsePageLimit(searchParams.get('limit'), 20, 50);
    const scope = hashCursorScope({ resource: 'client-orders', clientId: id });
    const cursor = decodeTimestampCursor(searchParams.get('cursor'), scope);
    const where = {
      clientId: id,
      ...(cursor && {
        OR: [
          { timestamp: { lt: new Date(cursor.timestamp) } },
          { timestamp: new Date(cursor.timestamp), id: { lt: cursor.id } },
        ],
      }),
    };
    const rows = await tenantPrisma.order.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, orderId: true, status: true, total: true, product: true, timestamp: true, orderType: true },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return NextResponse.json({
      status: 'success',
      data: {
        client,
        items,
        pageInfo: {
          hasMore,
          nextCursor: hasMore && last ? encodeTimestampCursor({ timestamp: last.timestamp.toISOString(), id: last.id }, scope) : null,
        },
      },
    }, { headers: PII_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid history query';
    const clientError = /Invalid|between/.test(message);
    if (!clientError) console.error('[automatic-clients/history]', message);
    return NextResponse.json({ error: clientError ? message : 'Failed to load client history' }, {
      status: clientError ? 400 : 500,
      headers: PII_NO_STORE_HEADERS,
    });
  }
}
