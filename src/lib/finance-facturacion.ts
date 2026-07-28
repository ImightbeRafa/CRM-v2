import { getTenantPrisma } from '@/lib/prisma-tenant';
import { buildStatsOrderDateWhere } from '@/lib/statistics-dates';
import type { FinanceDateRange } from '@/lib/finance-dates';
import type { FINANCE_TENANTS } from '@/lib/finance-tenants';

type FinanceTenant = (typeof FINANCE_TENANTS)[number];

export type FinanceBrandFacturacion = {
  brand: string;
  slug: string;
  tenantId: string;
  orderCount: number;
  revenueCrc: number;
  averageOrderValueCrc: number;
  activeClients: number;
};

/**
 * Facturación summary matching /estadisticas (all saved orders by saleDate/timestamp).
 * Not comparable 1:1 with logistics costs (delivered-only, completion date).
 */
export async function getFinanceFacturacionForTenant(
  tenant: FinanceTenant,
  range: FinanceDateRange,
): Promise<FinanceBrandFacturacion> {
  const prisma = getTenantPrisma(tenant.id);
  const orderModel = prisma.order as any;

  const whereClause = {
    tenantId: tenant.id,
    ...buildStatsOrderDateWhere(range.dateFrom, range.dateTo),
  };

  const [orderCount, revenueAgg, uniqueClients] = await Promise.all([
    orderModel.count({ where: whereClause }),
    orderModel.aggregate({
      where: whereClause,
      _sum: { total: true },
    }),
    orderModel.groupBy({
      by: ['customerName'],
      where: whereClause,
    }),
  ]);

  const revenueCrc = Number(revenueAgg._sum.total || 0);
  const averageOrderValueCrc = orderCount > 0 ? revenueCrc / orderCount : 0;

  return {
    brand: tenant.name,
    slug: tenant.slug,
    tenantId: tenant.id,
    orderCount,
    revenueCrc,
    averageOrderValueCrc,
    activeClients: uniqueClients.length,
  };
}
