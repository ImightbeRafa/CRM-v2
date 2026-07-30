import { NextRequest, NextResponse } from 'next/server';
import { performBackup } from '@/lib/backups/service';

export const maxDuration = 300;

function requireCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

function requireBackupApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.BACKUP_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: 'BACKUP_API_KEY not configured — refusing manual backup' },
      { status: 500 },
    );
  }
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== expected) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  return null;
}

/** Scheduled full backup (02:00 UTC). */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const result = await performBackup({ kind: 'full' });
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Full backup failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Backup failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

/** Manual full or hot backup via x-api-key. Body: { "kind": "full" | "hot" } */
export async function POST(request: NextRequest) {
  const denied = requireBackupApiKey(request);
  if (denied) return denied;

  try {
    let kind: 'full' | 'hot' = 'full';
    try {
      const body = await request.json();
      if (body?.kind === 'hot' || body?.kind === 'full') kind = body.kind;
    } catch {
      // empty body → full
    }
    const result = await performBackup({ kind });
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Manual backup failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Manual backup failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
