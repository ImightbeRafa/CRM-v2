import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get billing transactions for this tenant
    const transactions = await prisma.billingTransaction.findMany({
      where: { tenantId: token.tenantId as string },
      orderBy: { createdAt: 'desc' },
      take: 50 // Last 50 transactions
    });

    return NextResponse.json({
      status: 'success',
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching billing history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billing history' },
      { status: 500 }
    );
  }
}

