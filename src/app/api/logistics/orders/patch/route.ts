import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// PATCH /api/logistics/orders — persist carrier and/or status for a logistics order
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { orderId, carrier, status } = body;

    if (!orderId) {
        return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    try {
        // Upsert into lm_orders table
        const updates: Record<string, any> = { crm_order_id: orderId };
        if (carrier !== undefined) updates.carrier = carrier;
        if (status !== undefined) updates.status = status;
        updates.updated_at = new Date().toISOString();

        // Try update first, then insert
        const existing = await prisma.$queryRaw<any[]>`
      SELECT id FROM lm_orders WHERE crm_order_id = ${orderId} LIMIT 1
    `;

        if (existing.length > 0) {
            if (carrier !== undefined && status !== undefined) {
                await prisma.$executeRaw`
          UPDATE lm_orders SET carrier = ${carrier}, status = ${status}, updated_at = NOW()
          WHERE crm_order_id = ${orderId}
        `;
            } else if (carrier !== undefined) {
                await prisma.$executeRaw`
          UPDATE lm_orders SET carrier = ${carrier}, updated_at = NOW()
          WHERE crm_order_id = ${orderId}
        `;
            } else if (status !== undefined) {
                await prisma.$executeRaw`
          UPDATE lm_orders SET status = ${status}, updated_at = NOW()
          WHERE crm_order_id = ${orderId}
        `;
            }
        } else {
            const c = carrier || null;
            const s = status || 'Pendiente';
            await prisma.$executeRaw`
        INSERT INTO lm_orders (crm_order_id, carrier, status)
        VALUES (${orderId}, ${c}, ${s})
      `;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[logistics/orders PATCH]', error);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}

export { GET } from '../orders/route';
