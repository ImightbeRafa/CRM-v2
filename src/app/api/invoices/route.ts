import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const tenantId = user.memberships[0].tenantId;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build where clause
    const where: any = {
      tenantId: tenantId
    };

    if (status) {
      where.paymentStatus = status;
    }

    // Get invoices
    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        order: {
          select: {
            orderId: true,
            status: true
          }
        }
      }
    });

    return NextResponse.json({
      status: 'success',
      data: invoices
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}

