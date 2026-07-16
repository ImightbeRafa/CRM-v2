import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { syncLogisticsStatusToCrmOrders } from '@/lib/logistics-crm-sync';
import {
  applyRetiroDecrement,
  DEFAULT_RETIRO_AGENT,
  mapOrderLines,
  normalizePickupLocation,
  RETIRO_PICKUP_LOCATIONS,
} from '@/lib/retiro-stock';

const CR_TZ = 'America/Costa_Rica';

function getMondayCR(): string {
  const now = new Date();
  const crStr = now.toLocaleDateString('en-CA', { timeZone: CR_TZ });
  const [y, m, d] = crStr.split('-').map(Number);
  const crDate = new Date(y, m - 1, d);
  const day = crDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  crDate.setDate(crDate.getDate() + diff);
  const yy = crDate.getFullYear();
  const mm = String(crDate.getMonth() + 1).padStart(2, '0');
  const dd = String(crDate.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getSundayCR(monday: string): string {
  const [y, m, d] = monday.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 6);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function resolveActiveEmployee(employeeId: unknown) {
  if (typeof employeeId !== 'string' || !employeeId.trim()) return null;
  try {
    const id = employeeId.trim();
    const rows = await prisma.$queryRaw<{ id: string; display_name: string }[]>`
      SELECT id, display_name
      FROM lm_employees
      WHERE id = ${id}::uuid AND active = TRUE
      LIMIT 1
    `;
    return rows[0] ? { id: rows[0].id, displayName: rows[0].display_name } : null;
  } catch {
    return null;
  }
}

async function terminateRetiroOrder(orderId: string, actor: string) {
  const monday = getMondayCR();
  const sunday = getSundayCR(monday);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM lm_billing_weeks WHERE week_start = $1::date`,
      monday,
    );

    let weekId: number;
    if (existing.length > 0) {
      weekId = existing[0].id;
    } else {
      const inserted = await tx.$queryRawUnsafe<{ id: number }[]>(
        `INSERT INTO lm_billing_weeks (week_start, week_end)
         VALUES ($1::date, $2::date)
         ON CONFLICT (week_start) DO UPDATE SET week_end = EXCLUDED.week_end
         RETURNING id`,
        monday,
        sunday,
      );
      weekId = inserted[0].id;
    }

    const lm = await tx.$queryRawUnsafe<{ billed_week_id: number | null; archived_at: Date | null }[]>(
      `SELECT billed_week_id, archived_at FROM lm_orders WHERE crm_order_id = $1`,
      orderId,
    );
    const row = lm[0];
    if (!row) throw new Error('Orden no existe en logistics');

    if (row.billed_week_id != null) {
      if (row.archived_at == null) {
        await tx.$executeRawUnsafe(
          `UPDATE lm_orders SET archived_at = NOW() WHERE crm_order_id = $1 AND archived_at IS NULL`,
          orderId,
        );
      }
    } else {
      await tx.$executeRawUnsafe(
        `UPDATE lm_orders
         SET billed_week_id = $1, billed_at = NOW(), archived_at = NOW()
         WHERE crm_order_id = $2 AND billed_week_id IS NULL`,
        weekId,
        orderId,
      );
    }

    await syncLogisticsStatusToCrmOrders(tx, [orderId], 'Entregado');
    await tx.$executeRawUnsafe(
      `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
       VALUES ($1, 'retiro_confirmed', $2::jsonb, $3)`,
      orderId,
      JSON.stringify({ weekId, agent: DEFAULT_RETIRO_AGENT }),
      actor,
    );
  });
}

// POST /api/logistics/retiros/confirm
// Body: { orderId, employeeId, pickupLocation, agent? }
export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : DEFAULT_RETIRO_AGENT;
    const actor = req.headers.get('x-user-email') ?? 'system';
    const pickupLocation = normalizePickupLocation(body.pickupLocation);

    if (!orderId) {
      return NextResponse.json({ error: 'orderId requerido' }, { status: 400 });
    }
    if (!pickupLocation) {
      return NextResponse.json({
        error: 'Seleccioná el lugar de retiro (Laura Escazu o Marlenn Desamparados)',
      }, { status: 400 });
    }

    const employee = await resolveActiveEmployee(body.employeeId);
    if (!employee) {
      return NextResponse.json({ error: 'Seleccioná quién entregó el pedido' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        orderType: true,
        product: true,
        quantity: true,
        productDetails: true,
        contraEntrega: true,
        cePaymentConfirmed: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
    }
    if (order.orderType !== 'RA') {
      return NextResponse.json({ error: 'Solo se confirman retiros RA' }, { status: 400 });
    }

    const lmRows = await prisma.$queryRaw<{
      carrier: string | null;
      status: string | null;
      is_contra_entrega: boolean;
      contraentrega_collected: boolean;
      archived_at: Date | null;
    }[]>`
      SELECT carrier, status, is_contra_entrega, contraentrega_collected, archived_at
      FROM lm_orders
      WHERE crm_order_id = ${orderId}
      LIMIT 1
    `;
    const lm = lmRows[0];

    const isContraEntrega = Boolean(order.contraEntrega || lm?.is_contra_entrega);
    const isCollected = Boolean(order.cePaymentConfirmed || lm?.contraentrega_collected);
    if (isContraEntrega && !isCollected) {
      return NextResponse.json(
        { error: 'Este retiro es contra entrega. Confirmá el pago antes de marcarlo como retirado.' },
        { status: 400 },
      );
    }

    if (lm?.archived_at) {
      return NextResponse.json({ error: 'Este retiro ya fue archivado' }, { status: 409 });
    }

    // Ensure lm_orders row + retiro carrier
    if (!lm) {
      await prisma.$executeRaw`
        INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status, is_contra_entrega, contraentrega_collected)
        VALUES (${orderId}, ${order.tenantId}, 'retiro', 'Pendiente', ${order.contraEntrega}, ${order.cePaymentConfirmed})
      `;
    } else if (lm.carrier !== 'retiro') {
      await prisma.$executeRawUnsafe(
        `UPDATE lm_orders SET carrier = 'retiro', updated_at = NOW() WHERE crm_order_id = $1`,
        orderId,
      );
    }

    const lines = await mapOrderLines(order, agent);
    const stockResult = await applyRetiroDecrement({
      agentKey: agent,
      orderId,
      lines,
      actor,
      employeeId: employee.id,
      employeeName: employee.displayName,
      pickupLocation,
    });

    // Mark Entregado
    await prisma.$executeRawUnsafe(
      `UPDATE lm_orders
       SET status = 'Entregado', completed_at = NOW(), completed_by = $1, updated_at = NOW()
       WHERE crm_order_id = $2`,
      actor,
      orderId,
    );
    try {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'Entregado' },
      });
    } catch (syncErr) {
      console.error('[retiros/confirm] CRM status sync failed:', syncErr);
    }

    // Enrich audit event with location / who
    await prisma.$executeRawUnsafe(
      `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
       VALUES ($1, 'retiro_handoff', $2::jsonb, $3)`,
      orderId,
      JSON.stringify({
        pickupLocation,
        pickupLocationLabel: RETIRO_PICKUP_LOCATIONS[pickupLocation],
        handedByEmployeeId: employee.id,
        handedBy: employee.displayName,
        alreadyApplied: stockResult.alreadyApplied,
      }),
      actor,
    );

    await terminateRetiroOrder(orderId, actor);

    return NextResponse.json({
      success: true,
      alreadyApplied: stockResult.alreadyApplied,
      decrements: stockResult.decrements,
      handedBy: employee.displayName,
      pickupLocation,
      pickupLocationLabel: RETIRO_PICKUP_LOCATIONS[pickupLocation],
      confirmedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    console.error('[retiros/confirm POST]', error);
    return NextResponse.json({ error: error.message || 'No se pudo confirmar el retiro' }, { status: 400 });
  }
}
