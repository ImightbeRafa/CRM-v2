import { NextRequest, NextResponse } from 'next/server';
import { guardFinanceApi } from '@/lib/finance-auth';
import { parseFinanceDateRange } from '@/lib/finance-dates';
import { FINANCE_BRAND_LIST, resolveFinanceTenants } from '@/lib/finance-tenants';
import { getFinanceCostsForTenant, FINANCE_COST_RATES_META } from '@/lib/finance-costs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/v1/costs?dateFrom=&dateTo=&brand=deepsleep|bloom|deepclean|forge|all
 * Logistics cost aggregates (envío, impuestos, manejo, tilopay) — no order rows.
 */
export async function GET(req: NextRequest) {
  const guard = await guardFinanceApi(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const parsed = parseFinanceDateRange(
    url.searchParams.get('dateFrom'),
    url.searchParams.get('dateTo'),
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const tenants = resolveFinanceTenants(url.searchParams.get('brand'));
  if (!tenants) {
    return NextResponse.json(
      { error: `Invalid brand. Use ${FINANCE_BRAND_LIST}, or omit/all` },
      { status: 400 },
    );
  }

  try {
    // Sequential: production Prisma pool is connection_limit=1 — parallel tenants risk pool_timeout.
    const brands = [];
    for (const tenant of tenants) {
      brands.push(await getFinanceCostsForTenant(tenant, parsed.range));
    }

    const combined = brands.reduce(
      (acc, b) => ({
        packages: acc.packages + b.packages.total,
        envioCrc: acc.envioCrc + b.envio.totalCrc,
        impuestosCrc: acc.impuestosCrc + b.impuestos.totalCrc,
        manejoCrc: acc.manejoCrc + b.manejo.totalCrc,
        tilopayCrc: acc.tilopayCrc + b.tilopay.totalCrc,
        subtotalCrc: acc.subtotalCrc + b.subtotalCrc,
      }),
      { packages: 0, envioCrc: 0, impuestosCrc: 0, manejoCrc: 0, tilopayCrc: 0, subtotalCrc: 0 },
    );

    return NextResponse.json({
      currency: 'CRC',
      period: parsed.range,
      basis: {
        orders: 'Entregado only',
        dateField: 'COALESCE(lm_orders.completed_at, Order.timestamp) in America/Costa_Rica',
        includesBilledWeeks: true,
        excludesPayroll: true,
      },
      rates: FINANCE_COST_RATES_META,
      brands,
      combined,
    });
  } catch (error) {
    console.error('[finance/v1/costs]', error);
    return NextResponse.json({ error: 'Failed to fetch finance costs' }, { status: 500 });
  }
}
