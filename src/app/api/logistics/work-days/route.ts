import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

const HOURS_PER_FULL_DAY = 8;
const WORK_DAY_TYPES: Record<string, { hours: number; label: string }> = {
    off: { hours: 0, label: 'Libre' },
    full: { hours: 8, label: 'Dia completo' },
    half: { hours: 4, label: 'Medio dia' },
    short: { hours: 2, label: 'Turno corto' },
    custom: { hours: 0, label: 'Personalizado' },
};

function unitsFromHours(hours: number) {
    return Math.max(0, Math.min(HOURS_PER_FULL_DAY, hours)) / HOURS_PER_FULL_DAY;
}

function toWorkDateKey(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'string') {
        return value.includes('T') ? value.slice(0, 10) : value;
    }
    return '';
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

function normalizeWorkDayPayload(input: any) {
    const staffName = typeof input?.staffName === 'string' ? input.staffName.trim() : '';
    const workDate = typeof input?.workDate === 'string' ? input.workDate.trim() : '';
    const dayType = typeof input?.dayType === 'string' ? input.dayType : 'full';

    if (!staffName || !workDate) {
        throw new Error('staffName and workDate required');
    }
    if (!WORK_DAY_TYPES[dayType]) {
        throw new Error(`Invalid dayType: ${dayType}`);
    }

    const parsedHours = input?.hours == null ? WORK_DAY_TYPES[dayType].hours : Number(input.hours);
    if (!Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > HOURS_PER_FULL_DAY) {
        throw new Error('hours must be between 0 and 8');
    }

    const metadata = JSON.stringify({
        dayType,
        hours: parsedHours,
        units: unitsFromHours(parsedHours),
        label: typeof input?.label === 'string' && input.label.trim() ? input.label.trim() : WORK_DAY_TYPES[dayType].label,
        timeLabel: typeof input?.timeLabel === 'string' && input.timeLabel.trim() ? input.timeLabel.trim() : null,
        startTime: typeof input?.startTime === 'string' && input.startTime.trim() ? input.startTime.trim() : null,
        lunchMinutes: Number.isFinite(Number(input?.lunchMinutes)) ? Math.max(0, Math.min(120, Number(input.lunchMinutes))) : (parsedHours >= 8 ? 60 : 0),
        notes: typeof input?.notes === 'string' && input.notes.trim() ? input.notes.trim() : null,
    });

    return { staffName, workDate, dayType, hours: parsedHours, metadata };
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
                work_date: toWorkDateKey(row.work_date),
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

    try {
        const payload = normalizeWorkDayPayload(await req.json());
        const id = randomUUID();
        await prisma.$transaction([
            prisma.$executeRaw`DELETE FROM lm_work_days WHERE staff_name = ${payload.staffName} AND work_date = ${payload.workDate}::date`,
            prisma.$executeRaw`
                INSERT INTO lm_work_days (id, staff_name, work_date, notes)
                VALUES (${id}::uuid, ${payload.staffName}, ${payload.workDate}::date, ${payload.metadata})
            `,
        ]);
        return NextResponse.json({ success: true, id });
    } catch (error) {
        console.error('[work-days POST]', error);
        const message = error instanceof Error ? error.message : 'Failed to log work day';
        const status = message.includes('required') || message.includes('Invalid') || message.includes('hours') ? 400 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}

// DELETE /api/logistics/work-days — remove a work day by id
// PUT /api/logistics/work-days - atomically replace a schedule range.
export async function PUT(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const body = await req.json();
        const dateFrom = typeof body?.dateFrom === 'string' ? body.dateFrom.trim() : '';
        const dateTo = typeof body?.dateTo === 'string' ? body.dateTo.trim() : '';
        const staffNames: string[] = Array.isArray(body?.staffNames)
            ? body.staffNames.map((name: unknown) => String(name || '').trim()).filter(Boolean)
            : [];
        const entries = Array.isArray(body?.entries) ? body.entries : [];

        if (!dateFrom || !dateTo || staffNames.length === 0) {
            return NextResponse.json({ error: 'dateFrom, dateTo and staffNames required' }, { status: 400 });
        }

        const normalizedEntries = (entries as any[]).map(normalizeWorkDayPayload);

        for (const entry of normalizedEntries) {
            if (!staffNames.includes(entry.staffName)) {
                return NextResponse.json({ error: `Entry staffName is outside save range: ${entry.staffName}` }, { status: 400 });
            }
            if (entry.workDate < dateFrom || entry.workDate > dateTo) {
                return NextResponse.json({ error: `Entry workDate is outside save range: ${entry.workDate}` }, { status: 400 });
            }
        }

        const operations = [
            ...staffNames.map((staffName: string) =>
                prisma.$executeRaw`DELETE FROM lm_work_days WHERE staff_name = ${staffName} AND work_date >= ${dateFrom}::date AND work_date <= ${dateTo}::date`
            ),
            ...normalizedEntries.map((entry: ReturnType<typeof normalizeWorkDayPayload>) => {
                const id = randomUUID();
                return prisma.$executeRaw`
                    INSERT INTO lm_work_days (id, staff_name, work_date, notes)
                    VALUES (${id}::uuid, ${entry.staffName}, ${entry.workDate}::date, ${entry.metadata})
                `;
            }),
        ];

        await prisma.$transaction(operations);

        const staffPlaceholders = staffNames.map((_, index) => `$${index + 3}`).join(', ');
        const rows = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id, staff_name, work_date, notes, created_at
             FROM lm_work_days
             WHERE work_date >= $1::date
               AND work_date <= $2::date
               AND staff_name IN (${staffPlaceholders})
             ORDER BY work_date DESC`,
            dateFrom,
            dateTo,
            ...staffNames
        );

        const workDays = rows.map((row) => {
            const meta = getWorkDayMeta(row.notes);
            return {
                ...row,
                work_date: toWorkDateKey(row.work_date),
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

        return NextResponse.json({ success: true, saved: normalizedEntries.length, workDays });
    } catch (error) {
        console.error('[work-days PUT]', error);
        const message = error instanceof Error ? error.message : 'Failed to save work days';
        const status = message.includes('required') || message.includes('Invalid') || message.includes('hours') ? 400 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}

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
