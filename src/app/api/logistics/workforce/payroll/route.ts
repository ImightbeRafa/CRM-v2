import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getCurrentWeekStartKey, getWeekEndKey } from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function entryPayCrc(minutes: number, hourlyRate: number) {
  return Math.round((minutes / 60) * hourlyRate);
}

function mapEntry(row: any) {
  const paidMinutes = Number(row.paid_minutes) || 0;
  const hourlyRateCrc = Number(row.hourly_rate_crc) || 0;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.display_name,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    hourlyRateCrc,
    paidMinutes,
    payCrc: entryPayCrc(paidMinutes, hourlyRateCrc),
    source: row.source,
    correctionNote: row.correction_note,
  };
}

type PayrollEntry = ReturnType<typeof mapEntry>;

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom') || getCurrentWeekStartKey();
  const dateTo = url.searchParams.get('dateTo') || getWeekEndKey(dateFrom);

  try {
    const [entriesRows, openRows] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT te.*, e.display_name
        FROM lm_time_entries te
        INNER JOIN lm_employees e ON e.id = te.employee_id
        WHERE te.voided_at IS NULL
          AND te.clock_out_at IS NOT NULL
          AND te.clock_in_at >= (${dateFrom}::date AT TIME ZONE 'America/Costa_Rica')
          AND te.clock_in_at < ((${dateTo}::date + INTERVAL '1 day') AT TIME ZONE 'America/Costa_Rica')
        ORDER BY e.display_name ASC, te.clock_in_at ASC
      `,
      prisma.$queryRaw<any[]>`
        SELECT te.*, e.display_name
        FROM lm_time_entries te
        INNER JOIN lm_employees e ON e.id = te.employee_id
        WHERE te.voided_at IS NULL
          AND te.clock_out_at IS NULL
        ORDER BY te.clock_in_at ASC
      `,
    ]);

    const entries = entriesRows.map(mapEntry);
    const byEmployee = new Map<string, {
      employeeId: string;
      employeeName: string;
      paidMinutes: number;
      hours: number;
      totalCrc: number;
      entries: PayrollEntry[];
    }>();

    for (const entry of entries) {
      const existing = byEmployee.get(entry.employeeId) || {
        employeeId: entry.employeeId,
        employeeName: entry.employeeName,
        paidMinutes: 0,
        hours: 0,
        totalCrc: 0,
        entries: [] as PayrollEntry[],
      };
      existing.paidMinutes += entry.paidMinutes;
      existing.totalCrc += entry.payCrc;
      existing.entries.push(entry);
      existing.hours = Math.round((existing.paidMinutes / 60) * 100) / 100;
      byEmployee.set(entry.employeeId, existing);
    }

    const employees = Array.from(byEmployee.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    const totalPaidMinutes = employees.reduce((sum, employee) => sum + employee.paidMinutes, 0);
    const totalCrc = employees.reduce((sum, employee) => sum + employee.totalCrc, 0);

    return NextResponse.json({
      dateFrom,
      dateTo,
      totals: {
        paidMinutes: totalPaidMinutes,
        hours: Math.round((totalPaidMinutes / 60) * 100) / 100,
        totalCrc,
      },
      employees,
      entries,
      openEntries: openRows.map((row) => ({
        id: row.id,
        employeeId: row.employee_id,
        employeeName: row.display_name,
        clockInAt: row.clock_in_at,
        hourlyRateCrc: Number(row.hourly_rate_crc) || 0,
      })),
    });
  } catch (error) {
    console.error('[workforce/payroll GET]', error);
    return NextResponse.json({ error: 'Failed to fetch payroll' }, { status: 500 });
  }
}
