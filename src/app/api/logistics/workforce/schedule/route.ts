import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  employeeRow,
  getCurrentWeekStartKey,
  getRequestActorId,
  getWeekEndKey,
  normalizeTimeValue,
  parseMinutes,
  toWorkDateKey,
} from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ScheduleEntryInput = {
  employeeId: string;
  workDate: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  expectedPaidMinutes: number;
  lunchMinutes: number;
  isOff: boolean;
  notes: string | null;
};

async function audit(actorUserId: string | null, eventType: string, metadata: Record<string, unknown>) {
  await prisma.$executeRaw`
    INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
    VALUES (${actorUserId}, ${eventType}, 'schedule', NULL, ${JSON.stringify(metadata)}::jsonb)
  `;
}

async function fetchSchedule(dateFrom: string, dateTo: string) {
  const [employees, shifts] = await Promise.all([
    prisma.$queryRaw<any[]>`
      SELECT id, display_name, active, hourly_rate_crc, code_last_generated_at,
             legacy_staff_name, created_at, updated_at
      FROM lm_employees
      ORDER BY active DESC, display_name ASC
    `,
    prisma.$queryRaw<any[]>`
      SELECT
        s.id,
        s.employee_id,
        e.display_name,
        e.active,
        s.work_date,
        to_char(s.shift_start, 'HH24:MI') AS shift_start,
        to_char(s.shift_end, 'HH24:MI') AS shift_end,
        s.expected_paid_minutes,
        s.lunch_minutes,
        s.is_off,
        s.notes,
        s.created_at,
        s.updated_at
      FROM lm_schedule_shifts s
      INNER JOIN lm_employees e ON e.id = s.employee_id
      WHERE s.work_date >= ${dateFrom}::date
        AND s.work_date <= ${dateTo}::date
      ORDER BY e.display_name ASC, s.work_date ASC
    `,
  ]);

  return {
    dateFrom,
    dateTo,
    employees: employees.map(employeeRow),
    shifts: shifts.map((shift) => ({
      id: shift.id,
      employeeId: shift.employee_id,
      employeeName: shift.display_name,
      employeeActive: Boolean(shift.active),
      workDate: toWorkDateKey(shift.work_date),
      shiftStart: shift.shift_start,
      shiftEnd: shift.shift_end,
      expectedPaidMinutes: Number(shift.expected_paid_minutes) || 0,
      lunchMinutes: Number(shift.lunch_minutes) || 0,
      isOff: Boolean(shift.is_off),
      notes: shift.notes || '',
      createdAt: shift.created_at,
      updatedAt: shift.updated_at,
    })),
  };
}

function normalizeEntry(input: any, dateFrom: string, dateTo: string): ScheduleEntryInput {
  const employeeId = typeof input?.employeeId === 'string' ? input.employeeId.trim() : '';
  const workDate = typeof input?.workDate === 'string' ? input.workDate.trim() : '';
  if (!employeeId || !workDate) throw new Error('employeeId and workDate required');
  if (workDate < dateFrom || workDate > dateTo) throw new Error(`workDate outside range: ${workDate}`);

  const isOff = input?.isOff === true;
  const expectedPaidMinutes = isOff ? 0 : parseMinutes(input?.expectedPaidMinutes, 0, 1440);
  const lunchMinutes = isOff ? 0 : parseMinutes(input?.lunchMinutes, 0, 240);
  const shiftStart = isOff ? null : normalizeTimeValue(input?.shiftStart);
  const shiftEnd = isOff ? null : normalizeTimeValue(input?.shiftEnd);
  const notes = typeof input?.notes === 'string' && input.notes.trim() ? input.notes.trim() : null;

  if (!isOff && expectedPaidMinutes > 0 && (!shiftStart || !shiftEnd)) {
    throw new Error(`shiftStart and shiftEnd required for ${employeeId} on ${workDate}`);
  }

  return { employeeId, workDate, shiftStart, shiftEnd, expectedPaidMinutes, lunchMinutes, isOff, notes };
}

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom') || getCurrentWeekStartKey();
  const dateTo = url.searchParams.get('dateTo') || getWeekEndKey(dateFrom);

  try {
    return NextResponse.json(await fetchSchedule(dateFrom, dateTo));
  } catch (error) {
    console.error('[workforce/schedule GET]', error);
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const dateFrom = typeof body?.dateFrom === 'string' ? body.dateFrom.trim() : '';
    const dateTo = typeof body?.dateTo === 'string' ? body.dateTo.trim() : '';
    const employeeIds: string[] = Array.isArray(body?.employeeIds)
      ? body.employeeIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    const rawEntries: unknown[] = Array.isArray(body?.entries) ? body.entries : [];

    if (!dateFrom || !dateTo || dateTo < dateFrom) {
      return NextResponse.json({ error: 'Valid dateFrom and dateTo required' }, { status: 400 });
    }
    if (employeeIds.length === 0) {
      return NextResponse.json({ error: 'employeeIds required' }, { status: 400 });
    }

    const normalized = rawEntries.map((entry) => normalizeEntry(entry, dateFrom, dateTo));
    for (const entry of normalized) {
      if (!employeeIds.includes(entry.employeeId)) {
        return NextResponse.json({ error: `Entry employeeId is outside save range: ${entry.employeeId}` }, { status: 400 });
      }
    }

    const operations = [
      ...employeeIds.map((employeeId) =>
        prisma.$executeRaw`
          DELETE FROM lm_schedule_shifts
          WHERE employee_id = ${employeeId}::uuid
            AND work_date >= ${dateFrom}::date
            AND work_date <= ${dateTo}::date
        `
      ),
      ...normalized.map((entry) =>
        prisma.$executeRaw`
          INSERT INTO lm_schedule_shifts (
            employee_id,
            work_date,
            shift_start,
            shift_end,
            expected_paid_minutes,
            lunch_minutes,
            is_off,
            notes
          )
          VALUES (
            ${entry.employeeId}::uuid,
            ${entry.workDate}::date,
            ${entry.shiftStart}::time,
            ${entry.shiftEnd}::time,
            ${entry.expectedPaidMinutes},
            ${entry.lunchMinutes},
            ${entry.isOff},
            ${entry.notes}
          )
        `
      ),
    ];

    await prisma.$transaction(operations);
    await audit(getRequestActorId(req.headers), 'schedule_week_saved', {
      dateFrom,
      dateTo,
      employeeCount: employeeIds.length,
      entryCount: normalized.length,
    });

    return NextResponse.json({ success: true, saved: normalized.length, ...(await fetchSchedule(dateFrom, dateTo)) });
  } catch (error) {
    console.error('[workforce/schedule PUT]', error);
    const message = error instanceof Error ? error.message : 'Failed to save schedule';
    const status = message.includes('required') || message.includes('outside') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
