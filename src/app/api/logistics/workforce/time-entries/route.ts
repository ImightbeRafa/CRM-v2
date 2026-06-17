import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  calculatePaidMinutes,
  getCurrentWeekStartKey,
  getRequestActorId,
  getWeekEndKey,
  parseClockTimestamp,
} from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function audit(actorUserId: string | null, eventType: string, entityId: string | null, metadata: Record<string, unknown>) {
  await prisma.$executeRaw`
    INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
    VALUES (${actorUserId}, ${eventType}, 'time_entry', ${entityId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
      WHERE te.clock_in_at >= ($1::date AT TIME ZONE 'America/Costa_Rica')
        AND te.clock_in_at < (($2::date + INTERVAL '1 day') AT TIME ZONE 'America/Costa_Rica')
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

  try {
    const body = await req.json();
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const correctionNote = typeof body?.correctionNote === 'string' ? body.correctionNote.trim() : '';
    const shouldVoid = body?.voided === true;
    const hasClockInPatch = Object.prototype.hasOwnProperty.call(body, 'clockInAt');
    const hasClockOutPatch = Object.prototype.hasOwnProperty.call(body, 'clockOutAt');

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if ((shouldVoid || hasClockInPatch || hasClockOutPatch) && !correctionNote) {
      return NextResponse.json({ error: 'correctionNote required for time corrections' }, { status: 400 });
    }

    const existingRows = await prisma.$queryRaw<any[]>`
      SELECT te.*, e.display_name
      FROM lm_time_entries te
      INNER JOIN lm_employees e ON e.id = te.employee_id
      WHERE te.id = ${id}::uuid
      LIMIT 1
    `;
    const existing = existingRows[0];
    if (!existing) return NextResponse.json({ error: 'Time entry not found' }, { status: 404 });

    if (shouldVoid) {
      const rows = await prisma.$queryRaw<any[]>`
        UPDATE lm_time_entries
        SET voided_at = now(),
            correction_note = ${correctionNote},
            updated_by = ${getRequestActorId(req.headers)}
        WHERE id = ${id}::uuid
        RETURNING *
      `;
      await audit(getRequestActorId(req.headers), 'time_entry_voided', id, { correctionNote });
      return NextResponse.json({ entry: mapEntry({ ...rows[0], display_name: existing.display_name, employee_active: true }) });
    }

    const nextClockIn = hasClockInPatch
      ? parseClockTimestamp(body.clockInAt)
      : new Date(existing.clock_in_at);
    const nextClockOut = hasClockOutPatch
      ? parseClockTimestamp(body.clockOutAt)
      : (existing.clock_out_at ? new Date(existing.clock_out_at) : null);

    if (!nextClockIn) return NextResponse.json({ error: 'Valid clockInAt required' }, { status: 400 });
    if (hasClockOutPatch && !nextClockOut) return NextResponse.json({ error: 'Valid clockOutAt required' }, { status: 400 });
    if (nextClockOut && nextClockOut <= nextClockIn) {
      return NextResponse.json({ error: 'clockOutAt must be after clockInAt' }, { status: 400 });
    }

    const paidMinutes = nextClockOut ? calculatePaidMinutes(nextClockIn, nextClockOut) : null;
    const rows = await prisma.$queryRaw<any[]>`
      UPDATE lm_time_entries
      SET clock_in_at = ${nextClockIn},
          clock_out_at = ${nextClockOut},
          paid_minutes = ${paidMinutes},
          source = 'admin',
          correction_note = ${correctionNote},
          updated_by = ${getRequestActorId(req.headers)}
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    await audit(getRequestActorId(req.headers), 'time_entry_corrected', id, {
      correctionNote,
      clockInAt: nextClockIn.toISOString(),
      clockOutAt: nextClockOut?.toISOString() ?? null,
      paidMinutes,
    });

    return NextResponse.json({ entry: mapEntry({ ...rows[0], display_name: existing.display_name, employee_active: true }) });
  } catch (error) {
    console.error('[workforce/time-entries PATCH]', error);
    return NextResponse.json({ error: 'Failed to update time entry' }, { status: 500 });
  }
}
