import { NextRequest, NextResponse } from 'next/server';
import { forgetBackupStatusCache, getBackupStatus } from '@/lib/backups/service';
import { sendOpsAlert } from '@/lib/ops/alert-email';
import { requireCronBearer } from '@/lib/ops/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A missed nightly backup (02:00 UTC) is caught here at 06:00 UTC. */
const FULL_BACKUP_MAX_AGE_HOURS = 26;

/** Daily operations check (06:00 UTC): alerts the platform owner when backups are stale or broken. */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request);
  if (denied) return denied;

  forgetBackupStatusCache();
  const status = await getBackupStatus();
  const fullAge = status.full ? Math.round(status.full.hoursAgo) : null;
  const problem =
    status.status === 'unknown'
      ? 'No se pudo leer el almacenamiento de respaldos.'
      : !status.full
        ? 'No hay ningún respaldo completo.'
        : fullAge !== null && fullAge > FULL_BACKUP_MAX_AGE_HOURS
          ? `El último respaldo completo tiene ${fullAge} horas.`
          : !status.full.ok
            ? 'El último respaldo completo está incompleto.'
            : null;

  if (problem) {
    await sendOpsAlert({
      key: 'backup-stale',
      subject: 'Respaldos atrasados o fallando',
      lines: [problem, 'Abrí /backups y revisá Workers Logs del Worker betsy-crm-daytime-smoke.'],
    });
  }
  return NextResponse.json({ ok: !problem, backup: status.status, fullAgeHours: fullAge });
}
