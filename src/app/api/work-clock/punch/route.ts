import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { workClockRateLimit } from '@/lib/rate-limit';
import {
  calculatePaidMinutes,
  hashEmployeeCode,
} from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function audit(eventType: string, entityId: string | null, metadata: Record<string, unknown>) {
  await prisma.$executeRaw`
    INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
    VALUES (NULL, ${eventType}, 'time_entry', ${entityId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

export async function POST(req: NextRequest) {
  const rateLimitResult = await workClockRateLimit(req);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const body = await req.json();
    const action = body?.action === 'clock_out' ? 'clock_out' : body?.action === 'clock_in' ? 'clock_in' : null;
    if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    const codeHash = hashEmployeeCode(body?.code);
    const employees = await prisma.$queryRaw<any[]>`
      SELECT id, display_name, active, hourly_rate_crc
      FROM lm_employees
      WHERE code_hash = ${codeHash}
      LIMIT 1
    `;
    const employee = employees[0];
    if (!employee || !employee.active) {
      return NextResponse.json({ error: 'Invalid employee code' }, { status: 401 });
    }

    const openRows = await prisma.$queryRaw<any[]>`
      SELECT id, clock_in_at
      FROM lm_time_entries
      WHERE employee_id = ${employee.id}::uuid
        AND clock_out_at IS NULL
        AND voided_at IS NULL
      ORDER BY clock_in_at DESC
      LIMIT 1
    `;
    const openEntry = openRows[0];

    if (action === 'clock_in') {
      if (openEntry) {
        return NextResponse.json({ error: 'Employee already clocked in' }, { status: 409 });
      }
      const rows = await prisma.$queryRaw<any[]>`
        INSERT INTO lm_time_entries (employee_id, hourly_rate_crc, source)
        VALUES (${employee.id}::uuid, ${Number(employee.hourly_rate_crc) || 0}, 'worker')
        RETURNING id, clock_in_at, hourly_rate_crc
      `;
      await audit('worker_clocked_in', rows[0].id, { employeeId: employee.id });
      return NextResponse.json({
        status: 'clocked_in',
        employee: { id: employee.id, displayName: employee.display_name },
        entry: {
          id: rows[0].id,
          clockInAt: rows[0].clock_in_at,
          hourlyRateCrc: Number(rows[0].hourly_rate_crc) || 0,
        },
      });
    }

    if (!openEntry) {
      return NextResponse.json({ error: 'Employee is not clocked in' }, { status: 409 });
    }

    const now = new Date();
    const clockIn = new Date(openEntry.clock_in_at);
    const paidMinutes = calculatePaidMinutes(clockIn, now);
    const rows = await prisma.$queryRaw<any[]>`
      UPDATE lm_time_entries
      SET clock_out_at = ${now},
          paid_minutes = ${paidMinutes}
      WHERE id = ${openEntry.id}::uuid
      RETURNING id, clock_in_at, clock_out_at, hourly_rate_crc, paid_minutes
    `;
    await audit('worker_clocked_out', rows[0].id, { employeeId: employee.id, paidMinutes });

    return NextResponse.json({
      status: 'clocked_out',
      employee: { id: employee.id, displayName: employee.display_name },
      entry: {
        id: rows[0].id,
        clockInAt: rows[0].clock_in_at,
        clockOutAt: rows[0].clock_out_at,
        hourlyRateCrc: Number(rows[0].hourly_rate_crc) || 0,
        paidMinutes: Number(rows[0].paid_minutes) || 0,
      },
    });
  } catch (error) {
    console.error('[work-clock/punch POST]', error);
    const message = error instanceof Error && error.message.includes('EMPLOYEE_CODE_SECRET')
      ? 'Server misconfiguration'
      : error instanceof Error && error.message.includes('Invalid employee code')
        ? 'Invalid employee code'
      : 'Failed to register time punch';
    const status = message === 'Invalid employee code' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
