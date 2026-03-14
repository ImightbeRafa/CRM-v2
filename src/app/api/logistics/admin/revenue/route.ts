import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');

    const now = new Date();
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    const fromDate = fromParam
      ? new Date(`${fromParam}-01T00:00:00Z`)
      : new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const toDate = toParam
      ? new Date(`${toParam}-01T00:00:00Z`)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM.' }, { status: 400 });
    }

    const where: any = {
      status: 'success',
      periodStart: { gte: fromDate },
      periodEnd: { lte: new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0) },
    };
    if (tenantId) where.tenantId = tenantId;

    const transactions = await prisma.billingTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { name: true, plan: true } },
      },
    });

    const monthlyRevenue: Record<string, { revenue: number; count: number }> = {};
    const revenueByPlan: Record<string, number> = {};
    let totalRevenue = 0;

    for (const tx of transactions) {
      const month = tx.periodStart.toISOString().slice(0, 7);
      if (!monthlyRevenue[month]) monthlyRevenue[month] = { revenue: 0, count: 0 };
      monthlyRevenue[month].revenue += tx.amount;
      monthlyRevenue[month].count += 1;

      const plan = tx.tenant?.plan || 'UNKNOWN';
      revenueByPlan[plan] = (revenueByPlan[plan] || 0) + tx.amount;

      totalRevenue += tx.amount;
    }

    const monthlyArray = Object.entries(monthlyRevenue)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({
      totalRevenue,
      currency: transactions[0]?.currency || 'CRC',
      monthly: monthlyArray,
      revenueByPlan,
      transactions: transactions.slice(0, 100).map((tx) => ({
        id: tx.id,
        tenantName: tx.tenant?.name,
        plan: tx.tenant?.plan,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        description: tx.description,
        periodStart: tx.periodStart,
        periodEnd: tx.periodEnd,
        createdAt: tx.createdAt,
      })),
    });
  } catch (e: any) {
    console.error('[admin/revenue GET]', e.message);
    return NextResponse.json({ error: 'Failed to fetch revenue data' }, { status: 500 });
  }
}
