import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/feedback
 * List all feedback tickets across tenants (admin view).
 */
export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const priority = url.searchParams.get('priority');
    const category = url.searchParams.get('category');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;

    const [tickets, total] = await Promise.all([
      prisma.feedbackTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          tenant: { select: { name: true, businessName: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.feedbackTicket.count({ where }),
    ]);

    return NextResponse.json({ status: 'success', data: tickets, total });
  } catch (e: any) {
    console.error('[feedback GET]', e.message);
    return NextResponse.json({ status: 'success', data: [], total: 0, error: e.message });
  }
}

/**
 * PATCH /api/logistics/feedback
 * Update ticket status, priority, admin notes.
 */
export async function PATCH(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const { id, status, priority, adminNotes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Ticket id required' }, { status: 400 });
    }

    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    const validPriorities = ['low', 'normal', 'high', 'critical'];

    const data: any = {};
    if (status && validStatuses.includes(status)) {
      data.status = status;
      if (status === 'resolved') data.resolvedAt = new Date();
    }
    if (priority && validPriorities.includes(priority)) data.priority = priority;
    if (adminNotes !== undefined) data.adminNotes = (adminNotes || '').slice(0, 5000);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const ticket = await prisma.feedbackTicket.update({
      where: { id },
      data,
      include: {
        tenant: { select: { name: true, businessName: true } },
        user: { select: { name: true, email: true } },
      },
    });

    return NextResponse.json({ status: 'success', data: ticket });
  } catch (e: any) {
    console.error('[feedback PATCH]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
