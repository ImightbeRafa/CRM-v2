import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma as globalPrisma } from '@/lib/db';
import { isSuperAdmin } from '@/lib/super-admin-helpers';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    const isSuper = await isSuperAdmin(token.sub);
    if (!isSuper) {
      return NextResponse.json(
        { error: 'Access denied. Super admin only.' },
        { status: 403 }
      );
    }

    // Get global statistics across all tenants
    const [
      tenantsData,
      ordersToday,
      ordersThisWeek,
      ordersThisMonth,
      totalRevenue,
      activeUsers
    ] = await Promise.all([
      // Tenant statistics
      globalPrisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          isActive: true,
          createdAt: true,
          subscriptionStatus: true,
          _count: {
            select: {
              orders: true,
              clients: true,
              memberships: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      
      // Orders today
      globalPrisma.order.count({
        where: {
          timestamp: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      
      // Orders this week
      globalPrisma.order.count({
        where: {
          timestamp: {
            gte: new Date(new Date().setDate(new Date().getDate() - 7))
          }
        }
      }),
      
      // Orders this month
      globalPrisma.order.count({
        where: {
          timestamp: {
            gte: new Date(new Date().setDate(1))
          }
        }
      }),
      
      // Total revenue
      globalPrisma.order.aggregate({
        _sum: { total: true }
      }),
      
      // Active users
      globalPrisma.user.count({
        where: { active: true }
      })
    ]);

    // Calculate aggregated stats
    const totalTenants = tenantsData.length;
    const activeTenants = tenantsData.filter(t => t.isActive).length;
    const totalOrders = tenantsData.reduce((sum, t) => sum + t._count.orders, 0);
    const totalClients = tenantsData.reduce((sum, t) => sum + t._count.clients, 0);

    // Group tenants by plan
    const tenantsByPlan = tenantsData.reduce((acc, t) => {
      acc[t.plan] = (acc[t.plan] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Get top tenants by orders
    const topTenantsByOrders = tenantsData
      .sort((a, b) => b._count.orders - a._count.orders)
      .slice(0, 10)
      .map(t => ({
        name: t.name,
        slug: t.slug,
        orders: t._count.orders,
        clients: t._count.clients,
        users: t._count.memberships,
        plan: t.plan,
        status: t.subscriptionStatus
      }));

    return NextResponse.json({
      summary: {
        totalTenants,
        activeTenants,
        totalOrders,
        totalClients,
        totalRevenue: totalRevenue._sum.total || 0,
        activeUsers,
        ordersToday,
        ordersThisWeek,
        ordersThisMonth
      },
      tenantsByPlan,
      topTenants: topTenantsByOrders,
      allTenants: tenantsData.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        isActive: t.isActive,
        subscriptionStatus: t.subscriptionStatus,
        createdAt: t.createdAt,
        stats: {
          orders: t._count.orders,
          clients: t._count.clients,
          users: t._count.memberships
        }
      }))
    });

  } catch (error) {
    console.error('[Super Admin] Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch super admin statistics' },
      { status: 500 }
    );
  }
}
