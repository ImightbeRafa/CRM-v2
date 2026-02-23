import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/carriers — list carrier configs
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const data = await prisma.$queryRaw<any[]>`
      SELECT id, carrier, key, value, description, created_at
      FROM lm_carrier_configs
      ORDER BY carrier ASC, key ASC
    `;
        return NextResponse.json({ carriers: data });
    } catch (error) {
        console.error('[logistics/carriers GET]', error);
        return NextResponse.json({ error: 'Failed to fetch carrier configs' }, { status: 500 });
    }
}

// POST /api/logistics/carriers — upsert a carrier config entry
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { carrier, key, value, description } = body;

    if (!carrier || !key || !value) {
        return NextResponse.json({ error: 'carrier, key, and value are required' }, { status: 400 });
    }

    try {
        const [row] = await prisma.$queryRaw<any[]>`
      INSERT INTO lm_carrier_configs (carrier, key, value, description)
      VALUES (${carrier}, ${key}, ${value}, ${description ?? null})
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description
      RETURNING *
    `;
        return NextResponse.json({ carrier: row }, { status: 201 });
    } catch (error) {
        console.error('[logistics/carriers POST]', error);
        return NextResponse.json({ error: 'Failed to save carrier config' }, { status: 500 });
    }
}

// DELETE /api/logistics/carriers — delete by id
export async function DELETE(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    try {
        await prisma.$executeRaw`DELETE FROM lm_carrier_configs WHERE id = ${id}::uuid`;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[logistics/carriers DELETE]', error);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
}
