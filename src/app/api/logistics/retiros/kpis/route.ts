import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  DEFAULT_RETIRO_AGENT,
  ensureRetiroStockTables,
  listRetiroStock,
  toCRDate,
  CR_TZ,
} from '@/lib/retiro-stock';

const MANAGED_TENANT_IDS = [
  'cmh32z0ol0000k004hvx9tg3p',
  'cmhsibjue0004js04gie724nx',
  'cmhutd1th0000jp04oqibtz54',
  'cmigornmw0000lb04kl75262e',
  'cmjdabz4d0000il04dyc5qmcc',
  'cmln5u7k70000ld042qify2og',
  'cmh44aerw0006vijg0640vfl0',
  'cmm4pv8fl0000jr045en1nik9',
];

const DEFAULT_CUTOFF = new Date('2026-02-22T00:00:00.000Z');

// GET /api/logistics/retiros/kpis?agent=laura
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const agent = req.nextUrl.searchParams.get('agent') || DEFAULT_RETIRO_AGENT;
    await ensureRetiroStockTables();

    const stock = await listRetiroStock(agent);
    const unitsOnHand = stock.reduce((sum, row) => sum + row.qty, 0);
    const lowStockSkus = stock.filter((row) => row.lowStock);
    const today = toCRDate(new Date());

    // Active RA orders (not archived)
    const raOrders = await prisma.order.findMany({
      where: {
        tenantId: { in: MANAGED_TENANT_IDS },
        orderType: 'RA',
        timestamp: { gte: DEFAULT_CUTOFF },
      },
      select: { id: true },
      take: 2000,
    });
    const orderIds = raOrders.map((o) => o.id);

    let pending = 0;
    let deliveredToday = 0;
    let scheduledToday = 0;
    let overdue = 0;

    if (orderIds.length > 0) {
      const lmRows = await prisma.$queryRawUnsafe<{
        crm_order_id: string;
        status: string | null;
        archived_at: Date | null;
        completed_at: Date | null;
      }[]>(
        `SELECT crm_order_id, status, archived_at, completed_at
         FROM lm_orders
         WHERE crm_order_id = ANY($1::text[])`,
        orderIds,
      );
      const lmMap = new Map(lmRows.map((r) => [r.crm_order_id, r]));

      const handoffs = await prisma.$queryRawUnsafe<{
        crm_order_id: string;
        scheduled_at: Date | null;
        confirmed_at: Date | null;
        stock_applied: boolean;
      }[]>(
        `SELECT crm_order_id, scheduled_at, confirmed_at, stock_applied
         FROM lm_retiro_handoffs
         WHERE crm_order_id = ANY($1::text[])`,
        orderIds,
      );
      const handoffMap = new Map(handoffs.map((h) => [h.crm_order_id, h]));

      const now = Date.now();

      for (const id of orderIds) {
        const lm = lmMap.get(id);
        const handoff = handoffMap.get(id);
        const isArchived = Boolean(lm?.archived_at);
        const status = lm?.status || 'Pendiente';
        const isDelivered = status === 'Entregado' || handoff?.stock_applied;

        if (!isArchived && !isDelivered && status !== 'Devuelto') {
          pending += 1;
          if (handoff?.scheduled_at) {
            const schedDate = toCRDate(handoff.scheduled_at);
            if (schedDate === today) scheduledToday += 1;
            if (new Date(handoff.scheduled_at).getTime() < now) overdue += 1;
          }
        }

        const confirmedAt = handoff?.confirmed_at || lm?.completed_at;
        if (confirmedAt && toCRDate(confirmedAt) === today) {
          deliveredToday += 1;
        }
      }

      // Also count confirms from movements today (covers archived)
      const movementToday = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
        `SELECT COUNT(DISTINCT crm_order_id)::int AS cnt
         FROM lm_retiro_stock_movements
         WHERE agent_key = $1
           AND reason = 'retiro'
           AND created_at >= ($2::date AT TIME ZONE '${CR_TZ}')
           AND created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')`,
        agent,
        today,
      );
      if ((movementToday[0]?.cnt || 0) > deliveredToday) {
        deliveredToday = Number(movementToday[0].cnt);
      }
    }

    return NextResponse.json({
      agent,
      pending,
      scheduledToday,
      overdue,
      deliveredToday,
      unitsOnHand,
      lowStockCount: lowStockSkus.length,
      lowStock: lowStockSkus.map((s) => ({ sku: s.sku, displayName: s.displayName, qty: s.qty, minQty: s.minQty })),
      totalSkus: stock.length,
    });
  } catch (error) {
    console.error('[retiros/kpis GET]', error);
    return NextResponse.json({ error: 'No se pudieron cargar los KPIs de retiros' }, { status: 500 });
  }
}
