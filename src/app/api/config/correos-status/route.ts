import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isCorreosWSConfigured } from '@/lib/correos';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config/correos-status
 *
 * Returns whether the platform-level Correos de Costa Rica WS
 * environment variables are configured.  Does NOT expose credential
 * values — only a boolean flag.
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ configured: isCorreosWSConfigured() });
}
