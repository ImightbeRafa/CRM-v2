import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { SQL_CR_CLOCK_IN_RANGE_P12 } from '@/lib/costa-rica-clock-range';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  calculatePaidMinutes,
  getCurrentWeekStartKey,
  getRequestActorId,
  getWeekEndKey,
  parseClockTimestamp,
} from '@/lib/logistics-workforce';
import { getWorkforceTimeEntryStatus } from '@/lib/workforce-time-entry-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mapEntry(row: any) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.display_name,
    employeeActive: Boolean(row.employee_active),
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    hourlyRateCrc: Number(row.hourly_rate_crc) || 0,
    paidMinutes: row.paid_minutes == null ? null : Number(row.paid_minutes),
    source: row.source,
    correctionNote: row.correction_note,
    voidedAt: row.voided_at,
    status: getWorkforceTimeEntryStatus(row.clock_out_at, row.voided_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isExplicitClear(value: unknown) {
  return value === null || value === '';
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUniqueViolation(error: any) {
  return error?.code === 'P2002'
    || (error?.code === 'P2010' && error?.meta?.code === '23505')
    || error?.meta?.code === '23505';
}

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('dateFrom') || getCurrentWeekStartKey();
  const dateTo = url.searchParams.get('dateTo') || getWeekEndKey(dateFrom);
  const status = url.searchParams.get('status') || 'all';
  const employeeId = url.searchParams.get('employeeId');

  try {
    const params: any[] = [dateFrom, dateTo];
    let sql = `
      SELECT
        te.*,
        e.display_name,
        e.active AS employee_active
      FROM lm_time_entries te
      INNER JOIN lm_employees e ON e.id = te.employee_id
      WHERE ${SQL_CR_CLOCK_IN_RANGE_P12}
    `;

    if (employeeId) {
      params.push(employeeId);
      sql += ` AND te.employee_id = $${params.length}::uuid`;
    }
    if (status === 'open') {
      sql += ' AND te.clock_out_at IS NULL AND te.voided_at IS NULL';
    } else if (status === 'closed') {
      sql += ' AND te.clock_out_at IS NOT NULL AND te.voided_at IS NULL';
    } else if (status === 'voided') {
      sql += ' AND te.voided_at IS NOT NULL';
    }

    sql += ' ORDER BY te.clock_in_at DESC';
    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);
    return NextResponse.json({ dateFrom, dateTo, entries: rows.map(mapEntry) });
  } catch (error) {
    console.error('[workforce/time-entries GET]', error);
    return NextResponse.json({ error: 'Failed to fetch time entries' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const correctionNote = typeof body?.correctionNote === 'string' ? body.correctionNote.trim() : '';
  const shouldVoid = body?.voided === true;
  const shouldRestore = body?.restored === true;
  const hasClockInPatch = Object.prototype.hasOwnProperty.call(body, 'clockInAt');
  const hasClockOutPatch = Object.prototype.hasOwnProperty.call(body, 'clockOutAt');
  const actorUserId = getRequestActorId(req.headers);

  if (!isUuid(id)) return NextResponse.json({ error: 'Valid id required' }, { status: 400 });
  if (shouldVoid && shouldRestore) {
    return NextResponse.json({ error: 'Choose either void or restore' }, { status: 400 });
  }
  if (!shouldVoid && !shouldRestore && !hasClockInPatch && !hasClockOutPatch) {
    return NextResponse.json({ error: 'No changes requested' }, { status: 400 });
  }
  if (!correctionNote) {
    return NextResponse.json({ error: 'correctionNote required for time corrections' }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const refs = await tx.$queryRaw<any[]>`
        SELECT employee_id
        FROM lm_time_entries
        WHERE id = ${id}::uuid
        LIMIT 1
      `;
      if (!refs[0]) return { kind: 'not_found' as const };

      const employeeId = refs[0].employee_id;
      await tx.$queryRaw`
        SELECT id
        FROM lm_employees
        WHERE id = ${employeeId}::uuid
        FOR UPDATE
      `;

      const existingRows = await tx.$queryRaw<any[]>`
        SELECT te.*, e.display_name, e.active AS employee_active
        FROM lm_time_entries te
        INNER JOIN lm_employees e ON e.id = te.employee_id
        WHERE te.id = ${id}::uuid
        FOR UPDATE OF te
      `;
      const existing = existingRows[0];
      if (!existing) return { kind: 'not_found' as const };
      const currentStatus = getWorkforceTimeEntryStatus(existing.clock_out_at, existing.voided_at);

      if (shouldVoid) {
        if (currentStatus === 'voided') {
          return { kind: 'unchanged' as const, entry: existing, replayed: true };
        }
        const rows = await tx.$queryRaw<any[]>`
          UPDATE lm_time_entries
          SET voided_at = now(),
              correction_note = ${correctionNote},
              updated_by = ${actorUserId}
          WHERE id = ${id}::uuid
            AND voided_at IS NULL
          RETURNING *
        `;
        await tx.$executeRaw`
          INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
          VALUES (${actorUserId}, ${'time_entry_voided'}, ${'time_entry'}, ${id}, ${JSON.stringify({ correctionNote })}::jsonb)
        `;
        return {
          kind: 'voided' as const,
          entry: { ...rows[0], display_name: existing.display_name, employee_active: existing.employee_active },
          replayed: false,
        };
      }

      if (shouldRestore) {
        if (currentStatus !== 'voided') {
          return { kind: 'conflict' as const, error: 'Time entry is not voided', entry: existing };
        }
        if (!existing.clock_out_at) {
          const otherOpen = await tx.$queryRaw<any[]>`
            SELECT id
            FROM lm_time_entries
            WHERE employee_id = ${employeeId}::uuid
              AND id <> ${id}::uuid
              AND clock_out_at IS NULL
              AND voided_at IS NULL
            LIMIT 1
          `;
          if (otherOpen[0]) {
            return {
              kind: 'conflict' as const,
              error: 'Employee already has another open time entry',
              entry: existing,
            };
          }
        }
        const rows = await tx.$queryRaw<any[]>`
          UPDATE lm_time_entries
          SET voided_at = NULL,
              source = 'admin',
              correction_note = ${correctionNote},
              updated_by = ${actorUserId}
          WHERE id = ${id}::uuid
            AND voided_at IS NOT NULL
          RETURNING *
        `;
        await tx.$executeRaw`
          INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
          VALUES (${actorUserId}, ${'time_entry_restored'}, ${'time_entry'}, ${id}, ${JSON.stringify({ correctionNote })}::jsonb)
        `;
        return {
          kind: 'restored' as const,
          entry: { ...rows[0], display_name: existing.display_name, employee_active: existing.employee_active },
          replayed: false,
        };
      }

      if (currentStatus === 'voided') {
        return {
          kind: 'conflict' as const,
          error: 'Restore the voided entry before editing it',
          entry: existing,
        };
      }

      let nextClockIn: Date;
      if (hasClockInPatch) {
        const parsed = parseClockTimestamp(body.clockInAt);
        if (!parsed) {
          return { kind: 'invalid' as const, error: 'Valid clockInAt with timezone required' };
        }
        nextClockIn = parsed;
      } else {
        nextClockIn = new Date(existing.clock_in_at);
      }

      let nextClockOut: Date | null;
      if (hasClockOutPatch) {
        if (isExplicitClear(body.clockOutAt)) {
          nextClockOut = null;
        } else {
          const parsed = parseClockTimestamp(body.clockOutAt);
          if (!parsed) {
            return { kind: 'invalid' as const, error: 'Valid clockOutAt with timezone, or null, required' };
          }
          nextClockOut = parsed;
        }
      } else {
        nextClockOut = existing.clock_out_at ? new Date(existing.clock_out_at) : null;
      }

      if (nextClockOut && nextClockOut <= nextClockIn) {
        return { kind: 'invalid' as const, error: 'clockOutAt must be after clockInAt' };
      }

      if (!nextClockOut) {
        const otherOpen = await tx.$queryRaw<any[]>`
          SELECT id
          FROM lm_time_entries
          WHERE employee_id = ${employeeId}::uuid
            AND id <> ${id}::uuid
            AND clock_out_at IS NULL
            AND voided_at IS NULL
          LIMIT 1
        `;
        if (otherOpen[0]) {
          return {
            kind: 'conflict' as const,
            error: 'Employee already has another open time entry',
            entry: existing,
          };
        }
      }

      const paidMinutes = nextClockOut ? calculatePaidMinutes(nextClockIn, nextClockOut) : null;
      const auditMetadata = {
        correctionNote,
        clockInAt: nextClockIn.toISOString(),
        clockOutAt: nextClockOut?.toISOString() ?? null,
        paidMinutes,
      };
      const rows = await tx.$queryRaw<any[]>`
        UPDATE lm_time_entries
        SET clock_in_at = ${nextClockIn},
            clock_out_at = ${nextClockOut},
            paid_minutes = ${paidMinutes},
            source = 'admin',
            correction_note = ${correctionNote},
            updated_by = ${actorUserId}
        WHERE id = ${id}::uuid
          AND voided_at IS NULL
        RETURNING *
      `;
      await tx.$executeRaw`
        INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
        VALUES (${actorUserId}, ${'time_entry_corrected'}, ${'time_entry'}, ${id}, ${JSON.stringify(auditMetadata)}::jsonb)
      `;
      return {
        kind: 'corrected' as const,
        entry: { ...rows[0], display_name: existing.display_name, employee_active: existing.employee_active },
        replayed: false,
      };
    });

    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Time entry not found' }, { status: 404 });
    }
    if (result.kind === 'invalid') {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (result.kind === 'conflict') {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    const entry = mapEntry(result.entry);
    return NextResponse.json({ entry, status: result.kind, replayed: result.replayed });
  } catch (error) {
    console.error('[workforce/time-entries PATCH]', error);
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'Employee already has another open time entry' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to update time entry' }, { status: 500 });
  }
}
