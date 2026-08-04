import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
  employeeRow,
  generateEmployeeCode,
  getRequestActorId,
  parsePositiveMoney,
} from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function audit(db: any, actorUserId: string | null, eventType: string, entityId: string | null, metadata: Record<string, unknown>) {
  await db.$executeRaw`
    INSERT INTO lm_workforce_audit_events (actor_user_id, event_type, entity_type, entity_id, metadata)
    VALUES (${actorUserId}, ${eventType}, 'employee', ${entityId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getEmployees() {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT id, display_name, active, hourly_rate_crc, code_last_generated_at,
           legacy_staff_name, created_at, updated_at
    FROM lm_employees
    ORDER BY active DESC, display_name ASC
  `;
  return rows.map(employeeRow);
}

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    return NextResponse.json({ employees: await getEmployees() });
  } catch (error) {
    console.error('[workforce/employees GET]', error);
    return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    const hourlyRateCrc = parsePositiveMoney(body?.hourlyRateCrc, 0);
    const shouldGenerateCode = body?.generateCode === true;

    if (!displayName) {
      return NextResponse.json({ error: 'displayName required' }, { status: 400 });
    }
    if (hourlyRateCrc <= 0) {
      return NextResponse.json({ error: 'hourlyRateCrc must be greater than 0' }, { status: 400 });
    }

    const generated = shouldGenerateCode ? generateEmployeeCode() : null;
    const employee = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        INSERT INTO lm_employees (
          display_name,
          hourly_rate_crc,
          code_hash,
          code_last_generated_at
        )
        VALUES (
          ${displayName},
          ${hourlyRateCrc},
          ${generated?.codeHash ?? null},
          ${generated ? new Date() : null}
        )
        RETURNING id, display_name, active, hourly_rate_crc, code_last_generated_at,
                  legacy_staff_name, created_at, updated_at
      `;
      const created = employeeRow(rows[0]);
      await audit(tx, getRequestActorId(req.headers), 'employee_created', created.id, {
        displayName,
        hourlyRateCrc,
        generatedCode: Boolean(generated),
      });
      return created;
    });

    return NextResponse.json({ employee, code: generated?.code ?? null }, { status: 201 });
  } catch (error) {
    console.error('[workforce/employees POST]', error);
    return NextResponse.json({ error: 'Failed to create employee' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!isUuid(id)) return NextResponse.json({ error: 'Valid id required' }, { status: 400 });

    const displayName =
      typeof body?.displayName === 'string' ? body.displayName.trim() : null;
    const active =
      typeof body?.active === 'boolean' ? body.active : null;
    const hourlyRateCrc =
      body?.hourlyRateCrc == null ? null : parsePositiveMoney(body.hourlyRateCrc, 0);
    const regenerateCode = body?.regenerateCode === true;
    const hasExpectedCodeVersion = Object.prototype.hasOwnProperty.call(body, 'expectedCodeLastGeneratedAt');
    const expectedCodeVersionRaw = body?.expectedCodeLastGeneratedAt;

    if (displayName !== null && !displayName) {
      return NextResponse.json({ error: 'displayName cannot be empty' }, { status: 400 });
    }
    if (hourlyRateCrc !== null && hourlyRateCrc <= 0) {
      return NextResponse.json({ error: 'hourlyRateCrc must be greater than 0' }, { status: 400 });
    }
    if (regenerateCode && !hasExpectedCodeVersion) {
      return NextResponse.json({ error: 'expectedCodeLastGeneratedAt required' }, { status: 400 });
    }

    let expectedCodeVersion: Date | null = null;
    if (regenerateCode && expectedCodeVersionRaw !== null) {
      expectedCodeVersion = new Date(expectedCodeVersionRaw);
      if (Number.isNaN(expectedCodeVersion.getTime())) {
        return NextResponse.json({ error: 'Invalid expectedCodeLastGeneratedAt' }, { status: 400 });
      }
    }

    const generated = regenerateCode ? generateEmployeeCode() : null;
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<any[]>`
        SELECT id, code_last_generated_at
        FROM lm_employees
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      if (!locked[0]) return { kind: 'not_found' as const };

      if (regenerateCode) {
        const currentVersion = locked[0].code_last_generated_at
          ? new Date(locked[0].code_last_generated_at).getTime()
          : null;
        const expectedVersion = expectedCodeVersion?.getTime() ?? null;
        if (currentVersion !== expectedVersion) {
          return { kind: 'conflict' as const };
        }
      }

      const rows = await tx.$queryRaw<any[]>`
        UPDATE lm_employees
        SET
          display_name = COALESCE(${displayName}, display_name),
          active = COALESCE(${active}::boolean, active),
          hourly_rate_crc = COALESCE(${hourlyRateCrc}::numeric, hourly_rate_crc),
          code_hash = COALESCE(${generated?.codeHash ?? null}, code_hash),
          code_last_generated_at = CASE
            WHEN ${regenerateCode}::boolean THEN now()
            ELSE code_last_generated_at
          END
        WHERE id = ${id}::uuid
        RETURNING id, display_name, active, hourly_rate_crc, code_last_generated_at,
                  legacy_staff_name, created_at, updated_at
      `;
      const updated = employeeRow(rows[0]);
      await audit(tx, getRequestActorId(req.headers), regenerateCode ? 'employee_code_regenerated' : 'employee_updated', updated.id, {
        displayName,
        active,
        hourlyRateCrc,
        regeneratedCode: regenerateCode,
      });
      return { kind: 'updated' as const, employee: updated };
    });

    if (result.kind === 'not_found') {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    if (result.kind === 'conflict') {
      return NextResponse.json(
        { error: 'Employee code changed in another request. Refresh and try again.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ employee: result.employee, code: generated?.code ?? null });
  } catch (error) {
    console.error('[workforce/employees PATCH]', error);
    return NextResponse.json({ error: 'Failed to update employee' }, { status: 500 });
  }
}
