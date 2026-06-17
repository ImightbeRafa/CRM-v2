import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { workClockRateLimit } from '@/lib/rate-limit';
import {
  addDaysKey,
  getCurrentWeekStartKey,
  hashEmployeeCode,
  toWorkDateKey,
} from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicScheduleRow(row: any) {
  return {
    id: row.id,
    workDate: toWorkDateKey(row.work_date),
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    expectedPaidMinutes: Number(row.expected_paid_minutes) || 0,
    lunchMinutes: Number(row.lunch_minutes) || 0,
    isOff: Boolean(row.is_off),
    notes: row.notes || '',
  };
}

export async function POST(req: NextRequest) {
  const rateLimitResult = await workClockRateLimit(req);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const body = await req.json();
    const codeHash = hashEmployeeCode(body?.code);
    const employees = await prisma.$queryRaw<any[]>`
      SELECT id, display_name, active
      FROM lm_employees
      WHERE code_hash = ${codeHash}
      LIMIT 1
    `;
    const employee = employees[0];
    if (!employee || !employee.active) {
      return NextResponse.json({ error: 'Invalid employee code' }, { status: 401 });
    }

    const currentWeekStart = getCurrentWeekStartKey();
    const nextWeekEnd = addDaysKey(currentWeekStart, 13);
    const [schedule, openEntries] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT id, work_date, to_char(shift_start, 'HH24:MI') AS shift_start,
               to_char(shift_end, 'HH24:MI') AS shift_end, expected_paid_minutes,
               lunch_minutes, is_off, notes
        FROM lm_schedule_shifts
        WHERE employee_id = ${employee.id}::uuid
          AND work_date >= ${currentWeekStart}::date
          AND work_date <= ${nextWeekEnd}::date
        ORDER BY work_date ASC
      `,
      prisma.$queryRaw<any[]>`
        SELECT id, clock_in_at
        FROM lm_time_entries
        WHERE employee_id = ${employee.id}::uuid
          AND clock_out_at IS NULL
          AND voided_at IS NULL
        ORDER BY clock_in_at DESC
        LIMIT 1
      `,
    ]);

    return NextResponse.json({
      employee: {
        id: employee.id,
        displayName: employee.display_name,
      },
      currentWeekStart,
      nextWeekEnd,
      schedule: schedule.map(publicScheduleRow),
      openEntry: openEntries[0]
        ? { id: openEntries[0].id, clockInAt: openEntries[0].clock_in_at }
        : null,
    });
  } catch (error) {
    console.error('[work-clock/lookup POST]', error);
    const message = error instanceof Error && error.message.includes('EMPLOYEE_CODE_SECRET')
      ? 'Server misconfiguration'
      : 'Invalid employee code';
    const status = message === 'Server misconfiguration' ? 500 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
