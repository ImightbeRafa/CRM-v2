import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get Trial Status for Current User
 * Checks if user is in trial period and days remaining
 * Endpoint: GET /api/billing/trial-status
 */
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: token.tenantId as string },
      select: {
        id: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true
      }
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check if in trial period
    const now = new Date();
    const trialEndsAt = tenant.trialEndsAt || new Date(tenant.createdAt.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 days default
    const isInTrial = tenant.plan === 'FREE' && now < trialEndsAt;
    const daysRemaining = isInTrial ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

    return NextResponse.json({
      tenantId: tenant.id,
      currentPlan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      isInTrial,
      trialEndsAt: trialEndsAt.toISOString(),
      daysRemaining,
      trialExpired: !isInTrial && tenant.plan === 'FREE' && now >= trialEndsAt
    });

  } catch (error: any) {
    console.error('❌ Error getting trial status:', error);
    return NextResponse.json({ 
      error: 'Failed to get trial status',
      message: error.message 
    }, { status: 500 });
  }
}

