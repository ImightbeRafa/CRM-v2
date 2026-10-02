import { NextRequest, NextResponse } from 'next/server';
import { performBackup } from '@/lib/backups/service';
import { safeErrorCode, sendOpsAlert } from '@/lib/ops/alert-email';
import { requireApiKey, requireCronBearer } from '@/lib/ops/cron-auth';

export const maxDuration = 300;

async function run(kind: 'full' | 'hot', trigger: 'cron' | 'manual') {
  try {
    const result = await performBackup({ kind });
    return NextResponse.json(result);
  } catch (error) {
    const code = safeErrorCode(error);
    console.error(`❌ ${trigger === 'cron' ? 'Scheduled' : 'Manual'} ${kind} backup failed:`, code);
    await sendOpsAlert({
      key: `backup-failed:${kind}`,
      subject: `Respaldo ${kind === 'full' ? 'completo' : 'parcial'} FALLÓ`,
      lines: [
        `El respaldo ${kind} (${trigger}) no se completó.`,
        `Error: ${code}`,
        'Revisá Workers Logs del Worker betsy-crm-daytime-smoke y /backups.',
      ],
    });
    return NextResponse.json(
      { success: false, error: code, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** Scheduled full backup (02:00 UTC). */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request);
  if (denied) return denied;
  return run('full', 'cron');
}

/** Manual full or hot backup via x-api-key. Body: { "kind": "full" | "hot" } */
export async function POST(request: NextRequest) {
  const denied = requireApiKey(request, process.env.BACKUP_API_KEY, 'BACKUP_API_KEY');
  if (denied) return denied;
  let kind: 'full' | 'hot' = 'full';
  try {
    const body = await request.json();
    if (body?.kind === 'hot' || body?.kind === 'full') kind = body.kind;
  } catch {
    // empty body → full
  }
  return run(kind, 'manual');
}
