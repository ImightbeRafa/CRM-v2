import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/work-days?staffName=&dateFrom=&dateTo=
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const staffName = url.searchParams.get('staffName');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');

    try {
        let sql = 'SELECT id, staff_name, work_date, notes, created_at FROM lm_work_days WHERE 1=1';
        const params: any[] = [];
        if (staffName) { params.push(staffName); sql += ` AND staff_name = $${params.length}`; }
        if (dateFrom) { params.push(dateFrom); sql += ` AND work_date >= $${params.length}::date`; }
        if (dateTo) { params.push(dateTo); sql += ` AND work_date <= $${params.length}::date`; }
        sql += ' ORDER BY work_date DESC';
        const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

        return NextResponse.json({ workDays: rows });
    } catch (error) {
        console.error('[work-days GET]', error);
        return NextResponse.json({ error: 'Failed to fetch work days' }, { status: 500 });
    }
}

// POST /api/logistics/work-days — log a work day
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { staffName, workDate, notes } = await req.json();
    if (!staffName || !workDate) {
        return NextResponse.json({ error: 'staffName and workDate required' }, { status: 400 });
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO lm_work_days (staff_name, work_date, notes)
            VALUES (${staffName}, ${workDate}::date, ${notes ?? null})
            ON CONFLICT (staff_name, work_date) DO NOTHING
        `;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[work-days POST]', error);
        return NextResponse.json({ error: 'Failed to log work day' }, { status: 500 });
    }
}

// DELETE /api/logistics/work-days — remove a work day by id
export async function DELETE(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    try {
        await prisma.$executeRaw`DELETE FROM lm_work_days WHERE id = ${id}::uuid`;
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[work-days DELETE]', error);
        return NextResponse.json({ error: 'Failed to delete work day' }, { status: 500 });
    }
}
