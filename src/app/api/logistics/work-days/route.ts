import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

const HOURS_PER_FULL_DAY = 8;
const WORK_DAY_TYPES: Record<string, { hours: number; label: string }> = {
    full: { hours: 8, label: 'Dia completo' },
    half: { hours: 4, label: 'Medio dia' },
    short: { hours: 2, label: 'Turno corto' },
    custom: { hours: 0, label: 'Personalizado' },
};

function unitsFromHours(hours: number) {
    return Math.max(0, Math.min(HOURS_PER_FULL_DAY, hours)) / HOURS_PER_FULL_DAY;
}

function getWorkDayMeta(notes: unknown): { dayType: string; hours: number; units: number; label: string; timeLabel: string | null; startTime: string | null; lunchMinutes: number; notes: string | null } {
    const fallbackHours = WORK_DAY_TYPES.full.hours;
    const fallback = {
        dayType: 'full',
        hours: fallbackHours,
        units: unitsFromHours(fallbackHours),
        label: WORK_DAY_TYPES.full.label,
        timeLabel: null,
        startTime: null,
        lunchMinutes: 60,
        notes: typeof notes === 'string' ? notes : null,
    };
    if (typeof notes !== 'string' || !notes.trim()) return fallback;

    try {
        const parsed = JSON.parse(notes);
        const dayType = typeof parsed?.dayType === 'string' && WORK_DAY_TYPES[parsed.dayType] ? parsed.dayType : 'full';
        const parsedHours = Number(parsed?.hours);
        const hours = Number.isFinite(parsedHours) && parsedHours >= 0
            ? Math.max(0, Math.min(HOURS_PER_FULL_DAY, parsedHours))
            : WORK_DAY_TYPES[dayType].hours;
        const parsedUnits = Number(parsed?.units);
        const units = Number.isFinite(parsedUnits) && parsedUnits >= 0 && parsedUnits <= 1 ? parsedUnits : unitsFromHours(hours);
        return {
            dayType,
            hours,
            units,
            label: typeof parsed?.label === 'string' && parsed.label.trim() ? parsed.label.trim() : WORK_DAY_TYPES[dayType].label,
            timeLabel: typeof parsed?.timeLabel === 'string' && parsed.timeLabel.trim() ? parsed.timeLabel.trim() : null,
            startTime: typeof parsed?.startTime === 'string' && parsed.startTime.trim() ? parsed.startTime.trim() : null,
            lunchMinutes: Number.isFinite(Number(parsed?.lunchMinutes)) ? Math.max(0, Math.min(120, Number(parsed.lunchMinutes))) : (hours >= 8 ? 60 : 0),
            notes: typeof parsed?.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : null,
        };
    } catch {
        return fallback;
    }
}

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

        const workDays = rows.map((row) => {
            const meta = getWorkDayMeta(row.notes);
            return {
                ...row,
                notes: meta.notes,
                day_type: meta.dayType,
                hours: meta.hours,
                work_units: meta.units,
                day_label: meta.label,
                time_label: meta.timeLabel,
                start_time: meta.startTime,
                lunch_minutes: meta.lunchMinutes,
            };
        });

        return NextResponse.json({ workDays });
    } catch (error) {
        console.error('[work-days GET]', error);
        return NextResponse.json({ error: 'Failed to fetch work days' }, { status: 500 });
    }
}

// POST /api/logistics/work-days — log a work day
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { staffName, workDate, dayType = 'full', hours, timeLabel, startTime, lunchMinutes, label, notes } = await req.json();
    if (!staffName || !workDate) {
        return NextResponse.json({ error: 'staffName and workDate required' }, { status: 400 });
    }
    if (!WORK_DAY_TYPES[dayType]) {
        return NextResponse.json({ error: 'Invalid dayType' }, { status: 400 });
    }
    const parsedHours = hours == null ? WORK_DAY_TYPES[dayType].hours : Number(hours);
    if (!Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > HOURS_PER_FULL_DAY) {
        return NextResponse.json({ error: 'hours must be between 0 and 8' }, { status: 400 });
    }

    const metadata = JSON.stringify({
        dayType,
        hours: parsedHours,
        units: unitsFromHours(parsedHours),
        label: typeof label === 'string' && label.trim() ? label.trim() : WORK_DAY_TYPES[dayType].label,
        timeLabel: typeof timeLabel === 'string' && timeLabel.trim() ? timeLabel.trim() : null,
        startTime: typeof startTime === 'string' && startTime.trim() ? startTime.trim() : null,
        lunchMinutes: Number.isFinite(Number(lunchMinutes)) ? Math.max(0, Math.min(120, Number(lunchMinutes))) : (parsedHours >= 8 ? 60 : 0),
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    });

    try {
        const id = randomUUID();
        await prisma.$transaction([
            prisma.$executeRaw`DELETE FROM lm_work_days WHERE staff_name = ${staffName} AND work_date = ${workDate}::date`,
            prisma.$executeRaw`
                INSERT INTO lm_work_days (id, staff_name, work_date, notes)
                VALUES (${id}::uuid, ${staffName}, ${workDate}::date, ${metadata})
            `,
        ]);
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

    const { id, staffName, workDate } = await req.json();
    if (!id && (!staffName || !workDate)) {
        return NextResponse.json({ error: 'id or staffName/workDate required' }, { status: 400 });
    }

    try {
        if (id) {
            await prisma.$executeRaw`DELETE FROM lm_work_days WHERE id = ${id}::uuid`;
        } else {
            await prisma.$executeRaw`DELETE FROM lm_work_days WHERE staff_name = ${staffName} AND work_date = ${workDate}::date`;
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[work-days DELETE]', error);
        return NextResponse.json({ error: 'Failed to delete work day' }, { status: 500 });
    }
}
