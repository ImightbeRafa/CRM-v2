import { getOrderStatsDateKey } from '@/lib/statistics-dates';

export interface StatisticsV2Order {
  id: string;
  orderId: string;
  orderType: string;
  status: string;
  customerName: string;
  total: number | null;
  saleDate: string | null;
  timestamp: Date;
  seller: string | null;
  salesChannel: string | null;
  contraEntrega: boolean;
  cePaymentConfirmed: boolean;
}

export function buildStatisticsV2Overview(
  orders: StatisticsV2Order[],
  statusColors: Map<string, string>,
  now = new Date(),
) {
  let bookedGross = 0;
  let bookedCodGross = 0;
  let collectedCod = 0;
  let nonCodBooked = 0;
  const days = new Map<string, { date: string; revenue: number; bookedGross: number; collectedRevenue: number; pendingCod: number; orderCount: number }>();
  const types = { EA: { count: 0, revenue: 0 }, RA: { count: 0, revenue: 0 } };
  const statuses = new Map<string, number>();
  const customers = new Map<string, { customerName: string; totalRevenue: number; orderCount: number; first: Date; last: Date }>();

  for (const order of orders) {
    const total = Number(order.total || 0);
    bookedGross += total;
    if (order.contraEntrega) {
      bookedCodGross += total;
      if (order.cePaymentConfirmed) collectedCod += total;
    } else {
      nonCodBooked += total;
    }
    const collected = !order.contraEntrega || order.cePaymentConfirmed ? total : 0;
    const pending = order.contraEntrega && !order.cePaymentConfirmed ? total : 0;
    const date = getOrderStatsDateKey(order);
    if (date) {
      const current = days.get(date) || { date, revenue: 0, bookedGross: 0, collectedRevenue: 0, pendingCod: 0, orderCount: 0 };
      current.revenue += total;
      current.bookedGross += total;
      current.collectedRevenue += collected;
      current.pendingCod += pending;
      current.orderCount += 1;
      days.set(date, current);
    }
    const type = order.orderType === 'RA' ? 'RA' : 'EA';
    types[type].count += 1;
    types[type].revenue += total;
    statuses.set(order.status || 'Pendiente', (statuses.get(order.status || 'Pendiente') || 0) + 1);
    const name = order.customerName?.trim() || 'Sin nombre';
    const customer = customers.get(name) || { customerName: name, totalRevenue: 0, orderCount: 0, first: order.timestamp, last: order.timestamp };
    customer.totalRevenue += total;
    customer.orderCount += 1;
    if (order.timestamp < customer.first) customer.first = order.timestamp;
    if (order.timestamp > customer.last) customer.last = order.timestamp;
    customers.set(name, customer);
  }

  const collectedRevenue = nonCodBooked + collectedCod;
  const pendingCod = bookedCodGross - collectedCod;
  const customerRows = [...customers.values()].map(customer => {
    const daysSinceLastOrder = Math.floor((now.getTime() - customer.last.getTime()) / 86_400_000);
    return {
      customerName: customer.customerName,
      totalRevenue: customer.totalRevenue,
      orderCount: customer.orderCount,
      averageOrderValue: customer.orderCount ? customer.totalRevenue / customer.orderCount : 0,
      firstOrderDate: customer.first.toISOString(),
      lastOrderDate: customer.last.toISOString(),
      daysSinceLastOrder,
      customerStatus: daysSinceLastOrder <= 7 ? 'Very Active' : daysSinceLastOrder <= 30 ? 'Active' : daysSinceLastOrder <= 90 ? 'Moderate' : 'Inactive',
    };
  });
  const statusDistribution = customerRows.reduce<Record<string, number>>((result, customer) => {
    result[customer.customerStatus] = (result[customer.customerStatus] || 0) + 1;
    return result;
  }, {});

  return {
    definitions: {
      bookedGross: 'All saved order totals in the selected sale-date period.',
      collectedRevenue: 'Non-COD booked total plus confirmed COD. COD confirmation is attributed to the order sale date because no collection timestamp exists.',
    },
    revenue: { bookedGross, bookedCodGross, collectedCod, nonCodBooked, collectedRevenue, pendingCod },
    summary: {
      totalSales: orders.length,
      totalRevenue: bookedGross,
      averageOrderValue: orders.length ? bookedGross / orders.length : 0,
      activeClients: customers.size,
      trends: null,
    },
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    typeBreakdown: types,
    statusBreakdown: [...statuses.entries()].map(([status, count]) => ({
      status,
      count,
      percentage: orders.length ? count / orders.length * 100 : 0,
      color: statusColors.get(status) || '#6B7280',
    })),
    orders: orders.slice(0, 1_000).map(order => ({
      id: order.id, orderId: order.orderId, orderType: order.orderType || 'EA', status: order.status || 'Pendiente',
      customerName: order.customerName || 'Sin nombre', total: Number(order.total || 0), saleDate: order.saleDate,
      seller: order.seller, salesChannel: order.salesChannel, timestamp: order.timestamp.toISOString(),
    })),
    ordersTruncated: orders.length > 1_000,
    topCustomers: {
      topCustomersByRevenue: [...customerRows].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 10),
      topCustomersByOrders: [...customerRows].sort((a, b) => b.orderCount - a.orderCount || b.totalRevenue - a.totalRevenue).slice(0, 10),
      customerActivity: [...customerRows].sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate)).slice(0, 10),
      customerStatusDistribution: statusDistribution,
      summary: {
        totalCustomers: customers.size,
        activeCustomers: customerRows.filter(customer => customer.daysSinceLastOrder <= 30).length,
        totalRevenue: bookedGross,
        averageOrderValue: orders.length ? bookedGross / orders.length : 0,
      },
    },
  };
}
