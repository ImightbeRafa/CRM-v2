import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/cost-rules
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const data = await prisma.$queryRaw<any[]>`
      SELECT id, carrier, zone, weight_from, weight_to, cost, created_at
      FROM lm_cost_rules
      ORDER BY carrier ASC, zone ASC, weight_from ASC
    `;
        return NextResponse.json({ rules: data });
    } catch (error) {
        console.error('[logistics/cost-rules GET]', error);
        return NextResponse.json({ error: 'Failed to fetch cost rules' }, { status: 500 });
    }
}

// POST /api/logistics/cost-rules
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { carrier, zone, weight_from, weight_to, cost } = body;

    if (!carrier || !zone || weight_to === undefined || cost === undefined) {
        return NextResponse.json({ error: 'Missing required fields: carrier, zone, weight_to, cost' }, { status: 400 });
    }
    const wFrom = Number(weight_from ?? 0);
    const wTo = Number(weight_to);
    if (wTo <= wFrom) {
        return NextResponse.json({ error: 'weight_to must be greater than weight_from' }, { status: 400 });
    }

    try {
        const [row] = await prisma.$queryRaw<any[]>`
      INSERT INTO lm_cost_rules (carrier, zone, weight_from, weight_to, cost)
      VALUES (${carrier}, ${zone}, ${wFrom}, ${wTo}, ${Number(cost)})
      RETURNING *
    `;
        return NextResponse.json({ rule: row }, { status: 201 });
    } catch (error) {
        console.error('[logistics/cost-rules POST]', error);
        return NextResponse.json({ error: 'Failed to create cost rule' }, { status: 500 });
    }
}

// DELETE /api/logistics/cost-rules
export async function DELETE(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    try {
        await prisma.$executeRaw`DELETE FROM lm_cost_rules WHERE id = ${id}::uuid`;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[logistics/cost-rules DELETE]', error);
        return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
    }
}
