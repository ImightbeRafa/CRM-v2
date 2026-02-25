import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// GET /api/logistics/order-events?orderId=
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const orderId = url.searchParams.get('orderId');
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

    try {
        const events = await prisma.$queryRaw<any[]>`
            SELECT id, event_type, payload, actor, created_at
            FROM lm_order_events
            WHERE crm_order_id = ${orderId}
            ORDER BY created_at ASC
        `;
        return NextResponse.json({ events });
    } catch (error) {
        console.error('[order-events GET]', error);
        return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }
}

// POST /api/logistics/order-events — log a new event (e.g. manual note)
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const session = await getServerSession(authOptions);
    const actor = session?.user?.email ?? 'unknown';

    const { orderId, eventType, payload } = await req.json();
    if (!orderId || !eventType) {
        return NextResponse.json({ error: 'orderId and eventType required' }, { status: 400 });
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
            VALUES (${orderId}, ${eventType}, ${JSON.stringify(payload ?? {})}::jsonb, ${actor})
        `;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[order-events POST]', error);
        return NextResponse.json({ error: 'Failed to log event' }, { status: 500 });
    }
}
