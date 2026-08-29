import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { resolveCorreosWSCredentials } from '@/lib/correos';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config/correos-status
 *
 * Returns whether Correos WS credentials can be resolved (logistics DB
 * first, env fallback). Does NOT expose credential values.
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { source } = await resolveCorreosWSCredentials();
    return NextResponse.json({ configured: true, source });
  } catch {
    return NextResponse.json({ configured: false });
  }
}
