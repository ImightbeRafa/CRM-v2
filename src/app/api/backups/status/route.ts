import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getBackupStatus } from '@/lib/backups/service';
import { isSuperAdmin } from '@/lib/super-admin-helpers';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Platform backup health (all businesses' data): Betsy platform admins only. Business owners and
 * admins get 404 — they never see other tenants' table names or row counts. Never returns raw
 * error text. Answers within ~20 s even when storage is down (status `unknown`).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request);
  if (!auth.ok) return auth.response;
  if (!(await isSuperAdmin(auth.userId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  }
  try {
    const status = await getBackupStatus();
    return NextResponse.json(status, { headers: NO_STORE });
  } catch (error) {
    console.error('[backups/status] failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'Failed to fetch backup status' }, { status: 500, headers: NO_STORE });
  }
}
