import { NextRequest, NextResponse } from 'next/server';
import { guardFinanceApi } from '@/lib/finance-auth';
import { parseFinanceDateRange } from '@/lib/finance-dates';
import { FINANCE_BRAND_LIST, resolveFinanceTenants } from '@/lib/finance-tenants';
import { getFinanceFacturacionForTenant } from '@/lib/finance-facturacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/v1/facturacion?dateFrom=&dateTo=&brand=deepsleep|bloom|deepclean|forge|all
 * Revenue summary matching /estadisticas — not order-level.
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
      brands.push(await getFinanceFacturacionForTenant(tenant, parsed.range));
    }

    const combined = brands.reduce(
      (acc, b) => ({
        orderCount: acc.orderCount + b.orderCount,
        revenueCrc: acc.revenueCrc + b.revenueCrc,
        activeClientsPerBrandSum: acc.activeClientsPerBrandSum + b.activeClients,
      }),
      { orderCount: 0, revenueCrc: 0, activeClientsPerBrandSum: 0 },
    );

    return NextResponse.json({
      currency: 'CRC',
      period: parsed.range,
      basis: {
        orders: 'All saved orders (includes unconfirmed CE) — same as /estadisticas',
        dateField: 'saleDate when present, else Order.timestamp (CR stats rules)',
        warning:
          'Facturación and logistics costs use different order populations and date bases; do not subtract them as a pure margin without aligning periods intentionally.',
      },
      brands,
      combined: {
        ...combined,
        averageOrderValueCrc:
          combined.orderCount > 0 ? combined.revenueCrc / combined.orderCount : 0,
        note: 'activeClientsPerBrandSum can double-count customers who bought from both brands',
      },
    });
  } catch (error) {
    console.error('[finance/v1/facturacion]', error);
    return NextResponse.json({ error: 'Failed to fetch finance facturacion' }, { status: 500 });
  }
}
