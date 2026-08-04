import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { workClockPunchRateLimit } from '@/lib/rate-limit';
import {
  calculatePaidMinutes,
  hashEmployeeCode,
} from '@/lib/logistics-workforce';
import { decideWorkforcePunch } from '@/lib/workforce-time-entry-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PunchAction = 'clock_in' | 'clock_out';

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function publicOpenEntry(entry: any) {
  return entry ? { id: entry.id, clockInAt: entry.clock_in_at } : null;
}

export async function POST(req: NextRequest) {
  const rateLimitResult = await workClockPunchRateLimit(req);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const action: PunchAction | null = body?.action === 'clock_out'
    ? 'clock_out'
    : body?.action === 'clock_in'
      ? 'clock_in'
      : null;
  if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  const expectedEntryId = body?.expectedEntryId ?? null;
  if (expectedEntryId !== null && !isUuid(expectedEntryId)) {
    return NextResponse.json({ error: 'Invalid expected entry' }, { status: 400 });
  }

  let codeHash: string;
  try {
    codeHash = hashEmployeeCode(body?.code);
  } catch (error) {
    if (error instanceof Error && error.message.includes('EMPLOYEE_CODE_SECRET')) {
      console.error('[work-clock/punch POST] employee code secret is not configured');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Invalid employee code' }, { status: 401 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const employees = await tx.$queryRaw<any[]>`
        SELECT id, display_name, active, hourly_rate_crc
        FROM lm_employees
        WHERE code_hash = ${codeHash}
        LIMIT 1
      `;
      const employee = employees[0];
      if (!employee || !employee.active) return { kind: 'invalid_code' as const };

      // Every worker/admin mutation locks this stable row first. This makes the
      // employee's open-entry state authoritative inside the transaction.
      await tx.$queryRaw`
        SELECT id
        FROM lm_employees
        WHERE id = ${employee.id}::uuid
        FOR UPDATE
      `;

      const openRows = await tx.$queryRaw<any[]>`
        SELECT id, clock_in_at, hourly_rate_crc
        FROM lm_time_entries
        WHERE employee_id = ${employee.id}::uuid
          AND clock_out_at IS NULL
          AND voided_at IS NULL
        ORDER BY clock_in_at DESC
        LIMIT 1
      `;
      const openEntry = openRows[0];
      const decision = decideWorkforcePunch(
        action,
        openEntry?.id ?? null,
        expectedEntryId,
      );

      if (decision === 'already_open') {
        return { kind: 'already_clocked_in' as const, employee, entry: openEntry };
      }

      if (decision === 'create_entry') {
        const rows = await tx.$queryRaw<any[]>`
          INSERT INTO lm_time_entries (employee_id, hourly_rate_crc, source)
          VALUES (${employee.id}::uuid, ${Number(employee.hourly_rate_crc) || 0}, 'worker')
          RETURNING id, clock_in_at, hourly_rate_crc
        `;
        const created = rows[0];
        await tx.$executeRaw`
          INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
          VALUES (NULL, ${'worker_clocked_in'}, ${'time_entry'}, ${created.id}, ${JSON.stringify({ employeeId: employee.id })}::jsonb)
        `;
        return { kind: 'clocked_in' as const, employee, entry: created };
      }

      if (decision === 'check_closed_replay') {
        if (expectedEntryId) {
          const closedRows = await tx.$queryRaw<any[]>`
            SELECT id, clock_in_at, clock_out_at, hourly_rate_crc, paid_minutes
            FROM lm_time_entries
            WHERE id = ${expectedEntryId}::uuid
              AND employee_id = ${employee.id}::uuid
              AND clock_out_at IS NOT NULL
              AND voided_at IS NULL
            LIMIT 1
          `;
          if (closedRows[0]) {
            return { kind: 'already_clocked_out' as const, employee, entry: closedRows[0] };
          }
        }
        return { kind: 'not_clocked_in' as const, employee };
      }

      if (decision === 'not_open') {
        return { kind: 'not_clocked_in' as const, employee };
      }

      if (decision === 'state_conflict') {
        return { kind: 'state_conflict' as const, employee, entry: openEntry };
      }

      if (!openEntry) {
        return { kind: 'not_clocked_in' as const, employee };
      }

      const now = new Date();
      const clockIn = new Date(openEntry.clock_in_at);
      const paidMinutes = calculatePaidMinutes(clockIn, now);
      const rows = await tx.$queryRaw<any[]>`
        UPDATE lm_time_entries
        SET clock_out_at = ${now},
            paid_minutes = ${paidMinutes}
        WHERE id = ${openEntry.id}::uuid
          AND employee_id = ${employee.id}::uuid
          AND clock_out_at IS NULL
          AND voided_at IS NULL
        RETURNING id, clock_in_at, clock_out_at, hourly_rate_crc, paid_minutes
      `;
      const updated = rows[0];
      if (!updated) return { kind: 'state_conflict' as const, employee, entry: openEntry };

      await tx.$executeRaw`
        INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
        VALUES (NULL, ${'worker_clocked_out'}, ${'time_entry'}, ${updated.id}, ${JSON.stringify({ employeeId: employee.id, paidMinutes })}::jsonb)
      `;
      return { kind: 'clocked_out' as const, employee, entry: updated };
    });

    if (result.kind === 'invalid_code') {
      return NextResponse.json({ error: 'Invalid employee code' }, { status: 401 });
    }
    if (result.kind === 'not_clocked_in') {
      return NextResponse.json(
        { error: 'Employee is not clocked in', openEntry: null },
        { status: 409 },
      );
    }
    if (result.kind === 'state_conflict') {
      return NextResponse.json(
        {
          error: 'Clock state changed. Please try again.',
          openEntry: publicOpenEntry(result.entry),
        },
        { status: 409 },
      );
    }

    if (result.kind === 'clocked_in' || result.kind === 'already_clocked_in') {
      return NextResponse.json({
        status: result.kind,
        replayed: result.kind === 'already_clocked_in',
        employee: { id: result.employee.id, displayName: result.employee.display_name },
        openEntry: publicOpenEntry(result.entry),
        entry: {
          id: result.entry.id,
          clockInAt: result.entry.clock_in_at,
          hourlyRateCrc: Number(result.entry.hourly_rate_crc) || 0,
        },
      });
    }

    return NextResponse.json({
      status: result.kind,
      replayed: result.kind === 'already_clocked_out',
      employee: { id: result.employee.id, displayName: result.employee.display_name },
      openEntry: null,
      entry: {
        id: result.entry.id,
        clockInAt: result.entry.clock_in_at,
        clockOutAt: result.entry.clock_out_at,
        hourlyRateCrc: Number(result.entry.hourly_rate_crc) || 0,
        paidMinutes: Number(result.entry.paid_minutes) || 0,
      },
    });
  } catch (error) {
    console.error('[work-clock/punch POST]', error);
    return NextResponse.json(
      { error: 'Worker clock temporarily unavailable' },
      { status: 503 },
    );
  }
}
