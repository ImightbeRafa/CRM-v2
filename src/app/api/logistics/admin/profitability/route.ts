import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const now = new Date();
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    const fromMonth = fromParam || `${now.getFullYear()}-01`;
    const toMonth = toParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const periodRe = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!periodRe.test(fromMonth) || !periodRe.test(toMonth)) {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM.' }, { status: 400 });
    }

    const fromDate = new Date(`${fromMonth}-01T00:00:00Z`);
    const toDateParts = toMonth.split('-');
    const toDate = new Date(
      parseInt(toDateParts[0]),
      parseInt(toDateParts[1]),
      0,
      23, 59, 59
    );

    const [successfulTx, costRows] = await Promise.all([
      prisma.billingTransaction.findMany({
        where: {
          status: 'success',
          periodStart: { gte: fromDate },
          periodEnd: { lte: toDate },
        },
        select: {
          amount: true,
          currency: true,
          periodStart: true,
        },
      }),

      prisma.$queryRaw<any[]>`
        SELECT period, SUM(amount) as total, currency
        FROM lm_operational_costs
        WHERE period >= ${fromMonth} AND period <= ${toMonth}
        GROUP BY period, currency
        ORDER BY period ASC
      `,
    ]);

    const revenueByMonth: Record<string, number> = {};
    let totalRevenue = 0;
    for (const tx of successfulTx) {
      const month = tx.periodStart.toISOString().slice(0, 7);
      revenueByMonth[month] = (revenueByMonth[month] || 0) + tx.amount;
      totalRevenue += tx.amount;
    }

    const costsByMonth: Record<string, number> = {};
    let totalCosts = 0;
    for (const row of costRows) {
      const amt = Number(row.total);
      costsByMonth[row.period] = (costsByMonth[row.period] || 0) + amt;
      totalCosts += amt;
    }

    const allMonths = new Set([...Object.keys(revenueByMonth), ...Object.keys(costsByMonth)]);
    const monthly = Array.from(allMonths)
      .sort()
      .map((month) => {
        const revenue = revenueByMonth[month] || 0;
        const costs = costsByMonth[month] || 0;
        const profit = revenue - costs;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        return { month, revenue, costs, profit, margin: Math.round(margin * 100) / 100 };
      });

    const netProfit = totalRevenue - totalCosts;
    const overallMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return NextResponse.json({
      from: fromMonth,
      to: toMonth,
      totalRevenue,
      totalCosts,
      netProfit,
      overallMargin: Math.round(overallMargin * 100) / 100,
      monthly,
    });
  } catch (e: any) {
    console.error('[admin/profitability GET]', e.message);
    return NextResponse.json({ error: 'Failed to calculate profitability' }, { status: 500 });
  }
}
