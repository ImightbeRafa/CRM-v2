import { NextRequest, NextResponse } from 'next/server';
import { performBackup } from '@/lib/backups/service';

export const maxDuration = 300;

/** Scheduled hot backup (14:00 UTC) — high-churn CRM + all lm_*. */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await performBackup({ kind: 'hot' });
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Hot backup failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Hot backup failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
