import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const [tenants, activeUsers, totalMemberships] = await Promise.all([
      prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          isActive: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          createdAt: true,
          _count: {
            select: {
              orders: true,
              memberships: true,
              botSessions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.user.count({ where: { active: true } }),

      prisma.membership.count({ where: { isActive: true } }),
    ]);

    const activeTenants = tenants.filter((t) => t.isActive).length;
    const payingTenants = tenants.filter(
      (t) => t.subscriptionStatus === 'active' && t.plan !== 'FREE'
    ).length;
    const trialingTenants = tenants.filter(
      (t) => t.subscriptionStatus === 'trialing'
    ).length;

    const planDistribution: Record<string, number> = {};
    for (const t of tenants) {
      planDistribution[t.plan] = (planDistribution[t.plan] || 0) + 1;
    }

    return NextResponse.json({
      summary: {
        totalTenants: tenants.length,
        activeTenants,
        payingTenants,
        trialingTenants,
        activeUsers,
        totalMemberships,
      },
      planDistribution,
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        isActive: t.isActive,
        subscriptionStatus: t.subscriptionStatus,
        trialEndsAt: t.trialEndsAt,
        currentPeriodEnd: t.currentPeriodEnd,
        createdAt: t.createdAt,
        orders: t._count.orders,
        users: t._count.memberships,
        botSessions: t._count.botSessions,
      })),
    });
  } catch (e: any) {
    console.error('[admin/overview GET]', e.message);
    return NextResponse.json({ error: 'Failed to fetch overview' }, { status: 500 });
  }
}
