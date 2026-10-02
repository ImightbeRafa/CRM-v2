import { NextRequest, NextResponse } from 'next/server';
import { performBackup } from '@/lib/backups/service';
import { safeErrorCode, sendOpsAlert } from '@/lib/ops/alert-email';
import { requireCronBearer } from '@/lib/ops/cron-auth';

export const maxDuration = 300;

/** Scheduled hot backup (14:00 UTC) — high-churn CRM + all lm_*. */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request);
  if (denied) return denied;

  try {
    const result = await performBackup({ kind: 'hot' });
    return NextResponse.json(result);
  } catch (error) {
    const code = safeErrorCode(error);
    console.error('❌ Hot backup failed:', code);
    await sendOpsAlert({
      key: 'backup-failed:hot',
      subject: 'Respaldo parcial (14:00) FALLÓ',
      lines: ['El respaldo hot no se completó.', `Error: ${code}`, 'Revisá Workers Logs y /backups.'],
    });
    return NextResponse.json(
      { success: false, error: code, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
