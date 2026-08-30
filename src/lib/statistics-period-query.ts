/**
 * Period statistics without hydrating every order row into Node.
 * Totals and daily buckets use DB aggregates; detail lists stay capped.
 * Tenant id is always required on every query (SecureDog).
 */

import { Prisma } from '@prisma/client';
import {
  buildStatsDateRange,
  buildStatsOrderDateWhere,
  toStatsPeriodKey,
  type StatsGroupBy,
} from '@/lib/statistics-dates';
import { customerActivityStatus } from '@/lib/order-payment-status';
import type { StatisticsV2Order } from '@/lib/statistics-v2';

export const STATS_ORDER_DETAILS_CAP = 100;
export const PRODUCTION_LIST_DEFAULT_LIMIT = 100;

/** Accept base or tenant-extended Prisma clients without fighting extension generics. */
type StatsPrisma = {
  order: {
    count: (args: any) => Promise<any>;
    aggregate: (args: any) => Promise<any>;
    groupBy: (args: any) => Promise<any[]>;
    findMany: (args: any) => Promise<any[]>;
  };
  orderStatus: { findMany: (args: any) => Promise<Array<{ label: string; color: string | null }>> };
  $queryRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: any[]) => Promise<any>;
};

function periodWhere(tenantId: string, startDate?: string | null, endDate?: string | null) {
  return {
    tenantId,
    ...buildStatsOrderDateWhere(startDate, endDate),
  };
}

/**
 * Collected-revenue SQL matching isCollectedRevenue() when customFields
 * does not override paymentStatus (flag + status heuristics only).
 */
const COLLECTED_REVENUE_SQL = Prisma.sql`
  CASE
    WHEN o."contraEntrega" = true AND o."cePaymentConfirmed" = true THEN COALESCE(o."total", 0)
    WHEN o."contraEntrega" = true THEN 0
    WHEN LOWER(TRIM(COALESCE(o."status", ''))) IN (
      'cancelado', 'cancelled', 'canceled', 'anulado', 'rechazado', 'devuelto'
    ) THEN 0
    WHEN LOWER(TRIM(COALESCE(o."status", ''))) IN ('', 'pendiente') THEN 0
    ELSE COALESCE(o."total", 0)
  END
`;

const STATS_DATE_KEY_SQL = Prisma.sql`
  CASE
    WHEN NULLIF(TRIM(o."saleDate"), '') IS NOT NULL THEN LEFT(TRIM(o."saleDate"), 10)
    ELSE to_char(
      (o."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica',
      'YYYY-MM-DD'
    )
  END
`;

/** Raw WHERE matching buildStatsOrderDateWhere for the selected period. */
function periodDateSql(startDate: string, endDate: string) {
  const range = buildStatsDateRange(startDate, endDate);
  if (!range.start || !range.end || !range.startKey || !range.endKey) {
    throw new Error('Valid startDate and endDate are required');
  }
  return Prisma.sql`
    (
      (
        o."saleDate" IS NOT NULL
        AND o."saleDate" LIKE '%T%'
        AND o."saleDate" >= ${range.start.toISOString()}
        AND o."saleDate" <= ${range.end.toISOString()}
      )
      OR (
        o."saleDate" IS NOT NULL
        AND o."saleDate" <> ''
        AND o."saleDate" NOT LIKE '%T%'
        AND o."saleDate" >= ${range.startKey}
        AND o."saleDate" <= ${`${range.endKey}\uffff`}
      )
      OR (
        (o."saleDate" IS NULL OR o."saleDate" = '')
        AND o."timestamp" >= ${range.start}
        AND o."timestamp" <= ${range.end}
      )
    )
  `;
}

export async function fetchDailyRevenueAggregates(
  prisma: StatsPrisma,
  tenantId: string,
  startDate: string,
  endDate: string,
  groupBy: StatsGroupBy = 'day',
): Promise<Array<{ date: string; revenue: number; orderCount: number }>> {
  const rows = await prisma.$queryRaw`
    SELECT
      (${STATS_DATE_KEY_SQL}) AS date_key,
      COALESCE(SUM(COALESCE(o."total", 0)), 0)::float AS revenue,
      COUNT(*)::bigint AS order_count
    FROM "Order" o
    WHERE o."tenantId" = ${tenantId}
      AND ${periodDateSql(startDate, endDate)}
    GROUP BY 1
    ORDER BY 1 ASC
  ` as Array<{ date_key: string; revenue: number; order_count: bigint }>;

  if (groupBy === 'day') {
    return rows.map((row) => ({
      date: row.date_key,
      revenue: Number(row.revenue || 0),
      orderCount: Number(row.order_count || 0),
    }));
  }

  const grouped = new Map<string, { revenue: number; orderCount: number }>();
  for (const row of rows) {
    const key = toStatsPeriodKey(row.date_key, groupBy);
    const existing = grouped.get(key) || { revenue: 0, orderCount: 0 };
    grouped.set(key, {
      revenue: existing.revenue + Number(row.revenue || 0),
      orderCount: existing.orderCount + Number(row.order_count || 0),
    });
  }
  return Array.from(grouped.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchStatisticsV2PeriodOverview(
  prisma: StatsPrisma,
  args: { tenantId: string; startDate: string; endDate: string },
) {
  const { tenantId, startDate, endDate } = args;
  const where = periodWhere(tenantId, startDate, endDate);

  const [
    totalSales,
    revenueAgg,
    statusGroups,
    typeGroups,
    statuses,
    revenueRollupRaw,
    dailyRowsRaw,
    topByRevenueRaw,
    topByOrdersRaw,
    typeCollectedRaw,
    detailOrders,
  ] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { total: true } }),
    prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.order.groupBy({
      by: ['orderType'],
      where,
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.orderStatus.findMany({
      where: { tenantId, isActive: true },
      select: { label: true, color: true },
    }),
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(COALESCE(o."total", 0)), 0)::float AS booked_gross,
        COALESCE(SUM(CASE WHEN o."contraEntrega" = true THEN COALESCE(o."total", 0) ELSE 0 END), 0)::float AS booked_cod_gross,
        COALESCE(SUM(CASE WHEN o."contraEntrega" = true AND o."cePaymentConfirmed" = true THEN COALESCE(o."total", 0) ELSE 0 END), 0)::float AS collected_cod,
        COALESCE(SUM(CASE WHEN o."contraEntrega" = false THEN COALESCE(o."total", 0) ELSE 0 END), 0)::float AS non_cod_booked,
        COALESCE(SUM(${COLLECTED_REVENUE_SQL}), 0)::float AS collected_revenue,
        COUNT(DISTINCT NULLIF(TRIM(o."customerName"), ''))::bigint AS active_clients
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND ${periodDateSql(startDate, endDate)}
    `,
    prisma.$queryRaw`
      SELECT
        (${STATS_DATE_KEY_SQL}) AS date_key,
        COALESCE(SUM(COALESCE(o."total", 0)), 0)::float AS booked_gross,
        COALESCE(SUM(${COLLECTED_REVENUE_SQL}), 0)::float AS collected_revenue,
        COALESCE(SUM(CASE WHEN o."contraEntrega" = true AND o."cePaymentConfirmed" = false THEN COALESCE(o."total", 0) ELSE 0 END), 0)::float AS pending_cod,
        COUNT(*)::bigint AS order_count
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND ${periodDateSql(startDate, endDate)}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(TRIM(o."customerName"), ''), 'Sin nombre') AS customer_name,
        COALESCE(SUM(${COLLECTED_REVENUE_SQL}), 0)::float AS total_revenue,
        COUNT(*)::bigint AS order_count,
        MIN(o."timestamp") AS first_order,
        MAX(o."timestamp") AS last_order
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND ${periodDateSql(startDate, endDate)}
      GROUP BY 1
      ORDER BY total_revenue DESC, order_count DESC
      LIMIT 10
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(TRIM(o."customerName"), ''), 'Sin nombre') AS customer_name,
        COALESCE(SUM(${COLLECTED_REVENUE_SQL}), 0)::float AS total_revenue,
        COUNT(*)::bigint AS order_count,
        MIN(o."timestamp") AS first_order,
        MAX(o."timestamp") AS last_order
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND ${periodDateSql(startDate, endDate)}
      GROUP BY 1
      ORDER BY order_count DESC, total_revenue DESC
      LIMIT 10
    `,
    prisma.$queryRaw`
      SELECT
        CASE WHEN o."orderType" = 'RA' THEN 'RA' ELSE 'EA' END AS order_type,
        COALESCE(SUM(${COLLECTED_REVENUE_SQL}), 0)::float AS collected
      FROM "Order" o
      WHERE o."tenantId" = ${tenantId}
        AND ${periodDateSql(startDate, endDate)}
      GROUP BY 1
    `,
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        orderType: true,
        status: true,
        customerName: true,
        total: true,
        saleDate: true,
        timestamp: true,
        seller: true,
        salesChannel: true,
      },
      orderBy: [{ saleDate: 'desc' }, { timestamp: 'desc' }],
      take: STATS_ORDER_DETAILS_CAP,
    }),
  ]);

  const revenueRollup = revenueRollupRaw as Array<{
    booked_gross: number;
    booked_cod_gross: number;
    collected_cod: number;
    non_cod_booked: number;
    collected_revenue: number;
    active_clients: bigint;
  }>;
  const dailyRows = dailyRowsRaw as Array<{
    date_key: string;
    booked_gross: number;
    collected_revenue: number;
    pending_cod: number;
    order_count: bigint;
  }>;
  const topByRevenue = topByRevenueRaw as Array<{
    customer_name: string;
    total_revenue: number;
    order_count: bigint;
    first_order: Date;
    last_order: Date;
  }>;
  const topByOrders = topByOrdersRaw as Array<{
    customer_name: string;
    total_revenue: number;
    order_count: bigint;
    first_order: Date;
    last_order: Date;
  }>;
  const typeCollected = typeCollectedRaw as Array<{ order_type: string; collected: number }>;

  const rollup = revenueRollup[0] || {
    booked_gross: 0,
    booked_cod_gross: 0,
    collected_cod: 0,
    non_cod_booked: 0,
    collected_revenue: 0,
    active_clients: BigInt(0),
  };
  const bookedGross = Number(revenueAgg._sum.total ?? rollup.booked_gross ?? 0);
  const collectedRevenue = Number(rollup.collected_revenue || 0);
  const pendingCod = Number(rollup.booked_cod_gross || 0) - Number(rollup.collected_cod || 0);
  const activeClients = Number(rollup.active_clients || 0);
  const statusColors = new Map(statuses.map((s) => [s.label, s.color || '#3B82F6']));

  const typeBreakdown = { EA: { count: 0, revenue: 0 }, RA: { count: 0, revenue: 0 } };
  for (const group of typeGroups) {
    const key = group.orderType === 'RA' ? 'RA' : 'EA';
    typeBreakdown[key].count += group._count._all;
  }
  for (const row of typeCollected) {
    const key = row.order_type === 'RA' ? 'RA' : 'EA';
    typeBreakdown[key].revenue = Number(row.collected || 0);
  }

  const now = new Date();
  const mapCustomer = (row: {
    customer_name: string;
    total_revenue: number;
    order_count: bigint;
    first_order: Date;
    last_order: Date;
  }) => {
    const daysSinceLastOrder = Math.floor((now.getTime() - new Date(row.last_order).getTime()) / 86_400_000);
    const orderCount = Number(row.order_count || 0);
    const totalRevenue = Number(row.total_revenue || 0);
    return {
      customerName: row.customer_name,
      totalRevenue,
      orderCount,
      averageOrderValue: orderCount ? totalRevenue / orderCount : 0,
      firstOrderDate: new Date(row.first_order).toISOString(),
      lastOrderDate: new Date(row.last_order).toISOString(),
      daysSinceLastOrder,
      customerStatus: customerActivityStatus(daysSinceLastOrder),
    };
  };

  const topCustomersByRevenue = topByRevenue.map(mapCustomer);
  const topCustomersByOrders = topByOrders.map(mapCustomer);
  const customerActivity = [...topCustomersByRevenue]
    .sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate))
    .slice(0, 10);
  const customerStatusDistribution = topCustomersByRevenue.reduce<Record<string, number>>((result, customer) => {
    result[customer.customerStatus] = (result[customer.customerStatus] || 0) + 1;
    return result;
  }, {});

  return {
    definitions: {
      bookedGross: 'Todos los totales de pedidos guardados en el período.',
      collectedRevenue: 'Solo dinero cobrado: pago confirmado, contra entrega confirmada, o pedidos no pendientes con evidencia de cobro. Pendiente no se cuenta como cobrado.',
    },
    revenue: {
      bookedGross,
      bookedCodGross: Number(rollup.booked_cod_gross || 0),
      collectedCod: Number(rollup.collected_cod || 0),
      nonCodBooked: Number(rollup.non_cod_booked || 0),
      collectedRevenue,
      pendingCod,
    },
    summary: {
      totalSales,
      totalRevenue: bookedGross,
      averageOrderValue: totalSales > 0 ? bookedGross / totalSales : 0,
      activeClients,
      trends: null,
    },
    daily: dailyRows.map((row) => ({
      date: row.date_key,
      revenue: Number(row.booked_gross || 0),
      bookedGross: Number(row.booked_gross || 0),
      collectedRevenue: Number(row.collected_revenue || 0),
      pendingCod: Number(row.pending_cod || 0),
      orderCount: Number(row.order_count || 0),
    })),
    typeBreakdown,
    statusBreakdown: statusGroups.map((group) => ({
      status: group.status || 'Pendiente',
      count: group._count._all,
      percentage: totalSales > 0 ? (group._count._all / totalSales) * 100 : 0,
      color: statusColors.get(group.status) || '#6B7280',
    })),
    orders: (detailOrders as StatisticsV2Order[]).map((order) => ({
      id: order.id,
      orderId: order.orderId,
      orderType: order.orderType || 'EA',
      status: order.status || 'Pendiente',
      customerName: order.customerName || 'Sin nombre',
      total: Number(order.total || 0),
      saleDate: order.saleDate,
      seller: order.seller,
      salesChannel: order.salesChannel,
      timestamp: order.timestamp.toISOString(),
    })),
    ordersTruncated: totalSales > STATS_ORDER_DETAILS_CAP,
    topCustomers: {
      topCustomersByRevenue,
      topCustomersByOrders,
      customerActivity,
      customerStatusDistribution,
      summary: {
        totalCustomers: activeClients,
        activeCustomers: topCustomersByRevenue.filter((c) => c.daysSinceLastOrder <= 30).length,
        totalRevenue: bookedGross,
        averageOrderValue: totalSales > 0 ? bookedGross / totalSales : 0,
      },
    },
  };
}

export function assertTenantScopedOrderRows(
  tenantId: string,
  rows: Array<{ tenantId?: string | null }>,
): void {
  const leaked = rows.filter((row) => row.tenantId && row.tenantId !== tenantId);
  if (leaked.length > 0) {
    throw new Error(`CRITICAL TENANT ISOLATION BREACH: ${leaked.length} row(s)`);
  }
}
