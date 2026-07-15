import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { DEFAULT_RETIRO_AGENT, getHandoffsForOrders, upsertRetiroSchedule } from '@/lib/retiro-stock';

function formatPickupLabel(date: Date): string {
  return date.toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// GET /api/logistics/retiros/schedule?ids=id1,id2
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const idsParam = req.nextUrl.searchParams.get('ids') || '';
    const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 500);
    const handoffs = await getHandoffsForOrders(ids);
    return NextResponse.json({ handoffs });
  } catch (error) {
    console.error('[retiros/schedule GET]', error);
    return NextResponse.json({ error: 'No se pudieron cargar las citas de retiro' }, { status: 500 });
  }
}

// PATCH /api/logistics/retiros/schedule
// Body: { orderId, scheduledAt: ISO string | null }
export async function PATCH(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : DEFAULT_RETIRO_AGENT;
    const actor = req.headers.get('x-user-email') ?? 'system';

    if (!orderId) {
      return NextResponse.json({ error: 'orderId requerido' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderType: true },
    });
    if (!order) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
    }
    if (order.orderType !== 'RA') {
      return NextResponse.json({ error: 'Solo órdenes RA pueden programar retiro' }, { status: 400 });
    }

    let scheduledAt: Date | null = null;
    if (body.scheduledAt !== null && body.scheduledAt !== undefined && body.scheduledAt !== '') {
      const parsed = new Date(body.scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'scheduledAt inválido' }, { status: 400 });
      }
      scheduledAt = parsed;
    }

    await upsertRetiroSchedule({ orderId, scheduledAt, agentKey: agent, actor });

    const pickupDate = scheduledAt ? formatPickupLabel(scheduledAt) : null;
    await prisma.order.update({
      where: { id: orderId },
      data: {
        pickupDate,
        agreedDate: pickupDate,
      },
    });

    return NextResponse.json({
      success: true,
      orderId,
      scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
      pickupDate,
    });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }
    console.error('[retiros/schedule PATCH]', error);
    return NextResponse.json({ error: 'No se pudo guardar la cita de retiro' }, { status: 500 });
  }
}
