import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/changelog
 * Returns recent global changelog entries for authenticated users.
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const entries = await prisma.changelogEntry.findMany({
      where: { tenantId: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({ status: 'success', data: entries });
  } catch (e: any) {
    console.error('[changelog public GET]', e.message);
    return NextResponse.json({ status: 'success', data: [] });
  }
}
