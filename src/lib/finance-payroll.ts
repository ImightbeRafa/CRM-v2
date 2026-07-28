import { prisma } from '@/lib/db';
import type { FinanceDateRange } from '@/lib/finance-dates';

function entryPayCrc(minutes: number, hourlyRate: number) {
  return Math.round((minutes / 60) * hourlyRate);
}

export type FinancePayrollEmployee = {
  employeeId: string;
  employeeName: string;
  paidMinutes: number;
  hours: number;
  totalCrc: number;
  entryCount: number;
};

export type FinancePayrollResult = {
  scope: 'logistics_global';
  note: string;
  dateFrom: string;
  dateTo: string;
  totals: {
    paidMinutes: number;
    hours: number;
    totalCrc: number;
    employeeCount: number;
  };
  employees: FinancePayrollEmployee[];
};

/**
 * Per-employee weekly payroll (same source as /logistics/workforce).
 * Global logistics workforce — not split by DeepSleep/Bloom.
 * Excludes open (still clocked-in) and voided entries.
 */
export async function getFinancePayroll(range: FinanceDateRange): Promise<FinancePayrollResult> {
  const entriesRows = await prisma.$queryRaw<any[]>`
    SELECT
      te.employee_id,
      e.display_name,
      te.paid_minutes,
      te.hourly_rate_crc
    FROM lm_time_entries te
    INNER JOIN lm_employees e ON e.id = te.employee_id
    WHERE te.voided_at IS NULL
      AND te.clock_out_at IS NOT NULL
      AND te.clock_in_at >= (${range.dateFrom}::date AT TIME ZONE 'America/Costa_Rica')
      AND te.clock_in_at < ((${range.dateTo}::date + INTERVAL '1 day') AT TIME ZONE 'America/Costa_Rica')
    ORDER BY e.display_name ASC
  `;

  const byEmployee = new Map<string, FinancePayrollEmployee>();

  for (const row of entriesRows) {
    const paidMinutes = Number(row.paid_minutes) || 0;
    const hourlyRateCrc = Number(row.hourly_rate_crc) || 0;
    const payCrc = entryPayCrc(paidMinutes, hourlyRateCrc);
    const employeeId = String(row.employee_id);
    const existing = byEmployee.get(employeeId) || {
      employeeId,
      employeeName: String(row.display_name),
      paidMinutes: 0,
      hours: 0,
      totalCrc: 0,
      entryCount: 0,
    };
    existing.paidMinutes += paidMinutes;
    existing.totalCrc += payCrc;
    existing.entryCount += 1;
    existing.hours = Math.round((existing.paidMinutes / 60) * 100) / 100;
    byEmployee.set(employeeId, existing);
  }

  const employees = Array.from(byEmployee.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName),
  );
  const totalPaidMinutes = employees.reduce((sum, e) => sum + e.paidMinutes, 0);
  const totalCrc = employees.reduce((sum, e) => sum + e.totalCrc, 0);

  return {
    scope: 'logistics_global',
    note: 'Workforce payroll is shared across logistics brands (not DeepSleep/Bloom specific). Do not allocate into both brand cost totals.',
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    totals: {
      paidMinutes: totalPaidMinutes,
      hours: Math.round((totalPaidMinutes / 60) * 100) / 100,
      totalCrc,
      employeeCount: employees.length,
    },
    employees,
  };
}
