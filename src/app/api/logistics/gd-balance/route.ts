import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/gd-balance — Green Delivery running balance
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const entries = await prisma.$queryRaw<any[]>`
            SELECT id, amount, entry_type, description, entry_date, actor, created_at
            FROM lm_gd_balance_entries
            ORDER BY entry_date DESC, created_at DESC
            LIMIT 200
        `;

        // Running balance: charges positive, payments negative to balance
        const balance = entries.reduce((sum, e) => {
            return e.entry_type === 'charge'
                ? sum + Number(e.amount)
                : sum - Number(e.amount);
        }, 0);

        return NextResponse.json({ entries, balance });
    } catch (error) {
        console.error('[gd-balance GET]', error);
        return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
    }
}

// POST /api/logistics/gd-balance — add entry (charge or payment)
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { amount, entryType, description, entryDate } = await req.json();
    if (!amount || !entryType) {
        return NextResponse.json({ error: 'amount and entryType required' }, { status: 400 });
    }
    if (!['charge', 'payment'].includes(entryType)) {
        return NextResponse.json({ error: 'entryType must be charge or payment' }, { status: 400 });
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO lm_gd_balance_entries (amount, entry_type, description, entry_date)
            VALUES (${amount}, ${entryType}, ${description ?? null}, ${entryDate ?? new Date().toISOString().slice(0, 10)}::date)
        `;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[gd-balance POST]', error);
        return NextResponse.json({ error: 'Failed to add balance entry' }, { status: 500 });
    }
}

// DELETE /api/logistics/gd-balance
export async function DELETE(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    try {
        await prisma.$executeRaw`DELETE FROM lm_gd_balance_entries WHERE id = ${id}::uuid`;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[gd-balance DELETE]', error);
        return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }
}
