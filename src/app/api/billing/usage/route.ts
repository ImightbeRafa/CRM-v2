import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

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

    // Get tenant plan to know limits
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true }
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Define plan limits
    const planLimits: Record<string, { users: number; orders: number; storage: string }> = {
      FREE: { users: 1, orders: 100, storage: '500 MB' },
      BASIC: { users: 5, orders: 1000, storage: '5 GB' },
      PRO: { users: 25, orders: 999999, storage: 'Ilimitado' },
      ENTERPRISE: { users: 999999, orders: 999999, storage: 'Ilimitado' }
    };

    const limits = planLimits[tenant.plan] || planLimits.FREE;

    // Count current users
    const usersCount = await prisma.membership.count({
      where: {
        tenantId,
        isActive: true
      }
    });

    // Count orders this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const ordersCount = await prisma.order.count({
      where: {
        tenantId,
        timestamp: {
          gte: startOfMonth
        }
      }
    });

    return NextResponse.json({
      status: 'success',
      data: {
        users: {
          current: usersCount,
          limit: limits.users
        },
        orders: {
          current: ordersCount,
          limit: limits.orders
        },
        storage: {
          current: '0 MB', // TODO: Implement actual storage tracking
          limit: limits.storage
        }
      }
    });
  } catch (error) {
    console.error('Error fetching usage stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage stats' },
      { status: 500 }
    );
  }
}

