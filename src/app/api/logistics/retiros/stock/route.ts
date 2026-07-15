import { NextRequest, NextResponse } from 'next/server';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  adjustRetiroStock,
  DEFAULT_RETIRO_AGENT,
  listProductAliases,
  listRecentMovements,
  listRetiroStock,
} from '@/lib/retiro-stock';

// GET /api/logistics/retiros/stock?agent=laura
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const agent = req.nextUrl.searchParams.get('agent') || DEFAULT_RETIRO_AGENT;
    const [stock, movements, aliases] = await Promise.all([
      listRetiroStock(agent),
      listRecentMovements(agent, 25),
      listProductAliases(agent),
    ]);

    const unitsOnHand = stock.reduce((sum, row) => sum + row.qty, 0);
    const lowStockCount = stock.filter((row) => row.lowStock).length;

    return NextResponse.json({
      agent,
      stock,
      unitsOnHand,
      lowStockCount,
      aliases: aliases.map((a) => ({
        sku: a.sku,
        aliasNormalized: a.alias_normalized,
        aliasRaw: a.alias_raw,
        displayName: a.display_name,
      })),
      movements: movements.map((m) => ({
        id: m.id,
        sku: m.sku,
        displayName: m.display_name,
        delta: Number(m.delta),
        reason: m.reason,
        orderId: m.crm_order_id,
        actor: m.actor,
        employeeId: m.employee_id,
        notes: m.notes,
        createdAt: m.created_at,
      })),
    });
  } catch (error) {
    console.error('[retiros/stock GET]', error);
    return NextResponse.json({ error: 'No se pudo cargar el inventario de retiros' }, { status: 500 });
  }
}

// POST /api/logistics/retiros/stock — restock / adjust
// Body: { agent?, sku, delta, notes? }
export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : DEFAULT_RETIRO_AGENT;
    const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
    const delta = Number(body.delta);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : null;
    const actor = req.headers.get('x-user-email') ?? 'system';

    if (!sku) return NextResponse.json({ error: 'sku requerido' }, { status: 400 });
    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ error: 'delta debe ser un número distinto de 0' }, { status: 400 });
    }
    if (!Number.isInteger(delta)) {
      return NextResponse.json({ error: 'delta debe ser entero' }, { status: 400 });
    }
    if (Math.abs(delta) > 10000) {
      return NextResponse.json({ error: 'delta fuera de rango' }, { status: 400 });
    }

    const result = await adjustRetiroStock({
      agentKey: agent,
      sku,
      delta,
      reason: delta > 0 ? 'restock' : 'adjust',
      actor,
      notes,
    });

    const stock = await listRetiroStock(agent);
    return NextResponse.json({ success: true, result, stock });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    console.error('[retiros/stock POST]', error);
    return NextResponse.json({ error: error.message || 'No se pudo actualizar el stock' }, { status: 400 });
  }
}
