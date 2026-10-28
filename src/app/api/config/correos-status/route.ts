import { NextRequest, NextResponse } from 'next/server';
import { getLiveToken } from '@/lib/live-token';
import { resolveCorreosWSCredentials } from '@/lib/correos';
import { correosV3Status } from '@/lib/correos/v3/select';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config/correos-status
 *
 * Returns whether Correos WS credentials can be resolved (logistics DB
 * first, env fallback). Does NOT expose credential values.
 */
export async function GET(req: NextRequest) {
  const token = await getLiveToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let v3: { enabled: boolean; environment: string | null } = { enabled: false, environment: null };
  try {
    // "enabled" for this store = platform switch on AND the store is on the v3 allowlist.
    const s = await correosV3Status((token as { tenantId?: string | null }).tenantId ?? null);
    v3 = { enabled: s.configured && s.storeAllowed, environment: s.environment };
  } catch {
    // v3 status is optional
  }

  try {
    const { source } = await resolveCorreosWSCredentials();
    return NextResponse.json({ configured: true, source, v3 });
  } catch {
    return NextResponse.json({ configured: v3.enabled, v3 });
  }
}
