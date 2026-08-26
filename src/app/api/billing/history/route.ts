import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken } from '@/lib/selected-tenant';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await getMembershipForToken(token);
    if (!membership) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const tenantId = membership.tenantId;

    // Get billing transactions for this tenant
    const transactions = await prisma.billingTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50 // Last 50 transactions
    });

    console.log(`📊 Billing history: Found ${transactions.length} transactions for tenant ${tenantId}`);

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

