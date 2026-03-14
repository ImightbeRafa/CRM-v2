import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { getToken } from 'next-auth/jwt';
import { withTenantContext } from '@/lib/tenantContext';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;

    if (!tenantId || !userId) {
      return NextResponse.json({ error: 'Session incomplete' }, { status: 400 });
    }

    return await withTenantContext({ tenantId, userId, role }, async () => {
      const prisma = getTenantPrisma(tenantId);
      const tickets = await prisma.feedbackTicket.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return NextResponse.json({ status: 'success', data: tickets });
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tenantId = (token as any).currentTenant?.id || (token as any).tenantId;
    const userId = (token as any).sub || (token as any).id;
    const role = (token as any).currentTenant?.role || (token as any).membershipRole;

    if (!tenantId || !userId) {
      return NextResponse.json({ error: 'Session incomplete' }, { status: 400 });
    }

    const body = await request.json();
    const { category, subject, description, screenshotUrl } = body;

    if (!subject?.trim() || !description?.trim()) {
      return NextResponse.json({ error: 'Subject and description are required' }, { status: 400 });
    }

    const validCategories = ['bug', 'feature', 'question', 'other'];
    const safeCategory = validCategories.includes(category) ? category : 'other';

    return await withTenantContext({ tenantId, userId, role }, async () => {
      const prisma = getTenantPrisma(tenantId);
      const ticket = await prisma.feedbackTicket.create({
        data: {
          tenantId,
          userId,
          category: safeCategory,
          subject: subject.trim().slice(0, 200),
          description: description.trim().slice(0, 5000),
          screenshotUrl: screenshotUrl?.trim()?.slice(0, 500) || null,
        },
      });
      return NextResponse.json({ status: 'success', data: ticket });
    });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
