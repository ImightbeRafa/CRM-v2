import { prisma } from '@/lib/db';
import { getLogisticsRates } from '@/lib/logistics-rates';
import { calculateTilopayFees, isTilopayOrder, TILOPAY_FEE_RATES } from '@/lib/tilopay-fees';
import type { FinanceDateRange } from '@/lib/finance-dates';
import type { FINANCE_TENANTS } from '@/lib/finance-tenants';

const CR_TZ = 'America/Costa_Rica';
const CORREOS_TAX_RATE = 0.13;
/** Soft safety cap per brand query — protects the live pool on wide ranges. */
const MAX_ORDER_ROWS = 8000;

function getCorreosTax(cost: unknown): number {
  if (cost == null) return 0;
  const amount = Number(cost);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * CORREOS_TAX_RATE);
}

type FinanceTenant = (typeof FINANCE_TENANTS)[number];

export type FinanceBrandCosts = {
  brand: string;
  slug: string;
  tenantId: string;
  packages: {
    total: number;
    correos: number;
    mensajeria: number;
  };
  envio: {
    totalCrc: number;
    correosCrc: number;
    mensajeriaCrc: number;
    correosPendingCostCount: number;
  };
  impuestos: {
    totalCrc: number;
    rate: number;
    note: string;
  };
  manejo: {
    totalCrc: number;
    rateCrc: number;
    packages: number;
  };
  tilopay: {
    orders: number;
    totalCrc: number;
    commissionCrc: number;
    transactionCostCrc: number;
    serviceTaxCrc: number;
  };
  subtotalCrc: number;
  truncated: boolean;
};

/**
 * Logistics cost aggregates for one brand — mirrors /logistics/reports totals
 * without order-level rows or legacy daily salary (payroll is separate).
 *
 * Scope: Entregado orders dated by COALESCE(completed_at, order.timestamp) in CR.
 * Includes already-billed weeks (includeBilled equivalent) so finance can range freely.
 */
export async function getFinanceCostsForTenant(
  tenant: FinanceTenant,
  range: FinanceDateRange,
): Promise<FinanceBrandCosts> {
  const cfg = await getLogisticsRates(['mensajeria_rate', 'handling_rate']);
  const mensajeriaRate = cfg.mensajeria_rate;
  const handlingRate = cfg.handling_rate;

  const dateCol = 'COALESCE(lm.completed_at, o.timestamp)';
  const orders = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT DISTINCT ON (o.id)
      o.id, o.total, o.comments, o."customFields", o."salesChannel",
      lm.carrier, lm.correos_shipping_cost
    FROM "Order" o
    INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
    WHERE o."tenantId" = $1
      AND o."deletedAt" IS NULL
      AND lm.status = 'Entregado'
      AND ${dateCol} >= ($2::date AT TIME ZONE '${CR_TZ}')
      AND ${dateCol} < (($3::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')
    ORDER BY o.id
    LIMIT $4
    `,
    tenant.id,
    range.dateFrom,
    range.dateTo,
    MAX_ORDER_ROWS + 1,
  );

  const truncated = orders.length > MAX_ORDER_ROWS;
  if (truncated) orders.length = MAX_ORDER_ROWS;

  const correoOrders = orders.filter((o) => o.carrier === 'correos');
  const mensajeriaOrders = orders.filter((o) => o.carrier === 'mensajeria');

  const correosShipping = correoOrders.reduce(
    (s, o) => s + (o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : 0),
    0,
  );
  const correosTax = correoOrders.reduce((s, o) => s + getCorreosTax(o.correos_shipping_cost), 0);
  const correosPendingCost = correoOrders.filter((o) => o.correos_shipping_cost == null).length;
  const correosHandling = correoOrders.length * handlingRate;

  const mensajeriaShipping = mensajeriaOrders.length * mensajeriaRate;
  const mensajeriaHandling = mensajeriaOrders.length * handlingRate;

  const tilopayFeeRows = orders.map((o) =>
    calculateTilopayFees(o.total, isTilopayOrder(o)),
  );
  const tilopayOrderCount = tilopayFeeRows.filter((f) => f.isTilopay).length;
  const tilopayCommission = tilopayFeeRows.reduce((s, f) => s + f.commission, 0);
  const tilopayTransactionCost = tilopayFeeRows.reduce((s, f) => s + f.transactionCost, 0);
  const tilopayServiceTax = tilopayFeeRows.reduce((s, f) => s + f.serviceTax, 0);
  const tilopayFees = tilopayFeeRows.reduce((s, f) => s + f.total, 0);

  const totalShipping = correosShipping + mensajeriaShipping;
  const totalHandling = correosHandling + mensajeriaHandling;
  const subtotalCrc = totalShipping + totalHandling + correosTax + tilopayFees;

  return {
    brand: tenant.name,
    slug: tenant.slug,
    tenantId: tenant.id,
    packages: {
      total: orders.length,
      correos: correoOrders.length,
      mensajeria: mensajeriaOrders.length,
    },
    envio: {
      totalCrc: totalShipping,
      correosCrc: correosShipping,
      mensajeriaCrc: mensajeriaShipping,
      correosPendingCostCount: correosPendingCost,
    },
    impuestos: {
      totalCrc: correosTax,
      rate: CORREOS_TAX_RATE,
      note: '13% on Correos shipping only',
    },
    manejo: {
      totalCrc: totalHandling,
      rateCrc: handlingRate,
      packages: orders.length,
    },
    tilopay: {
      orders: tilopayOrderCount,
      totalCrc: tilopayFees,
      commissionCrc: tilopayCommission,
      transactionCostCrc: tilopayTransactionCost,
      serviceTaxCrc: tilopayServiceTax,
    },
    subtotalCrc,
    truncated,
  };
}

export const FINANCE_COST_RATES_META = {
  tilopay: TILOPAY_FEE_RATES,
  correosTaxRate: CORREOS_TAX_RATE,
} as const;
