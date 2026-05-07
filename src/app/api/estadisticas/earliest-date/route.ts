import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { resolveTenantId } from '@/lib/api-tenant';
import { formatStatsDateKey, normalizeStatsDateInput } from '@/lib/statistics-dates';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

// Lightweight in-memory cache – earliest date changes very rarely.
const earliestCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = await resolveTenantId(req, token);
    if (!tenantId) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const tenant = await globalPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { createdAt: true },
    });
    const tenantCreatedAt = tenant?.createdAt ?? null;

    const cached = earliestCache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    const prisma = getTenantPrisma(tenantId);

    // Find the earliest order by timestamp (DateTime – always present)
    // and by saleDate (String ISO – optional). Use whichever is earlier.
    const [oldestByTimestamp, oldestBySaleDate] = await Promise.all([
      prisma.order.findFirst({
        where: { tenantId },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true },
      }),
      prisma.order.findFirst({
        where: {
          tenantId,
          AND: [
            { saleDate: { not: null } },
            { saleDate: { not: '' } },
          ],
        },
        orderBy: { saleDate: 'asc' },
        select: { saleDate: true },
      }),
    ]);

    const candidates: Date[] = [];
    if (oldestByTimestamp?.timestamp) {
      candidates.push(new Date(oldestByTimestamp.timestamp));
    }
    if (oldestBySaleDate?.saleDate) {
      const dateKey = normalizeStatsDateInput(oldestBySaleDate.saleDate);
      if (dateKey) candidates.push(new Date(`${dateKey}T12:00:00.000Z`));
    }
    if (tenantCreatedAt) {
      candidates.push(new Date(tenantCreatedAt));
    }

    // Fall back to a safe, early date if the tenant has no orders and no createdAt.
    const earliest = candidates.length > 0
      ? new Date(Math.min(...candidates.map((d) => d.getTime())))
      : new Date('2000-01-01T00:00:00');

    const result = {
      earliestDate: formatStatsDateKey(earliest),
      hasOrders: Boolean(oldestByTimestamp),
    };

    earliestCache.set(tenantId, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching earliest date:', error);
    return NextResponse.json(
      { error: 'Failed to fetch earliest date' },
      { status: 500 }
    );
  }
}
