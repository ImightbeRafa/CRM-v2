import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/changelog
 * List all changelog entries (admin view).
 */
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const entries = await prisma.changelogEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json({ status: 'success', data: entries });
  } catch (e: any) {
    console.error('[changelog GET]', e.message);
    return NextResponse.json({ status: 'success', data: [], error: e.message });
  }
}

/**
 * POST /api/logistics/changelog
 * Create a new changelog entry.
 */
export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const userId = (token as any)?.sub || 'system';

    const body = await req.json();
    const { title, description, category } = body;

    if (!title?.trim() || !description?.trim()) {
      return NextResponse.json({ error: 'Title and description are required' }, { status: 400 });
    }

    const validCategories = ['feature', 'fix', 'improvement', 'announcement'];
    const safeCategory = validCategories.includes(category) ? category : 'improvement';

    const entry = await prisma.changelogEntry.create({
      data: {
        title: title.trim().slice(0, 200),
        description: description.trim().slice(0, 5000),
        category: safeCategory,
        createdBy: userId,
      },
    });

    return NextResponse.json({ status: 'success', data: entry });
  } catch (e: any) {
    console.error('[changelog POST]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
