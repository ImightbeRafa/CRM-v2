/**
 * Super Admin Helper Functions
 * 
 * Utilities for checking and handling super admin access
 * 
 * ⚠️ CRITICAL SECURITY WARNING ⚠️
 * Super admin access bypasses ALL tenant isolation.
 * Only use for authorized troubleshooting accounts.
 * All access is logged for audit purposes.
 */

import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { prisma as globalPrisma } from '@/lib/db';

// Optional: Whitelist of allowed super admin emails for additional security layer
// Add to .env: SUPER_ADMIN_EMAILS=peter@peter.com,admin@example.com
const SUPER_ADMIN_WHITELIST = process.env.SUPER_ADMIN_EMAILS?.split(',').map(e => e.trim()) || [];

/**
 * Check if a user is a super admin
 * 
 * ⚠️ SECURITY: This function determines if a user can bypass tenant isolation.
 * 
 * Multiple layers of protection:
 * 1. ✅ Database flag check (isSuperAdmin = true in User table)
 * 2. ✅ Environment variable whitelist (optional additional security)
 * 3. ✅ Comprehensive audit logging of all access attempts
 * 4. ✅ Alert on suspicious activity
 * 
 * @param userId - User ID to check
 * @returns true if user has super admin access, false otherwise
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  if (!userId) {
    return false;
  }

  try {
    const user = await globalPrisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true,
        email: true,
        isSuperAdmin: true,
        active: true
      }
    });

    if (!user) {
      return false;
    }

    // SECURITY: User must be active
    if (!user.active) {
      console.warn(`[SECURITY] Inactive user attempted super admin access: ${user.email}`);
      return false;
    }

    // Primary check: Database flag
    const hasFlag = user.isSuperAdmin === true;

    // Secondary check: Environment whitelist (if configured)
    // If no whitelist is set, only database flag is checked
    // If whitelist exists, user MUST be in both database AND whitelist
    const inWhitelist = SUPER_ADMIN_WHITELIST.length === 0 || 
                       SUPER_ADMIN_WHITELIST.includes(user.email);

    const isSuper = hasFlag && inWhitelist;

    // 🔒 SECURITY AUDIT: Log all super admin access checks
    if (hasFlag) {
      const logLevel = isSuper ? 'log' : 'warn';
      console[logLevel](`🔐 [SECURITY AUDIT] Super admin check`, {
        email: user.email,
        userId: user.id,
        databaseFlag: hasFlag,
        whitelistCheck: inWhitelist,
        whitelistActive: SUPER_ADMIN_WHITELIST.length > 0,
        accessGranted: isSuper,
        timestamp: new Date().toISOString()
      });
    }

    // 🚨 CRITICAL: Alert on security policy violation
    if (hasFlag && !inWhitelist) {
      console.error(`🚨 [SECURITY ALERT] Super admin database flag is set but email NOT in whitelist!`, {
        email: user.email,
        userId: user.id,
        action: 'ACCESS_DENIED',
        reason: 'NOT_IN_WHITELIST'
      });
    }

    return isSuper;
  } catch (error) {
    console.error('[Super Admin] Error checking super admin status:', error);
    // SECURITY: Fail closed - deny access on error
    return false;
  }
}

/**
 * Check if current request is from a super admin
 */
export async function isSuperAdminRequest(req: NextRequest): Promise<boolean> {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token || !token.sub) {
      return false;
    }
    return await isSuperAdmin(token.sub);
  } catch (error) {
    console.error('[Super Admin] Error checking request:', error);
    return false;
  }
}

/**
 * Get user info including super admin status
 */
export async function getUserWithSuperAdminStatus(userId: string) {
  try {
    return await globalPrisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        memberships: {
          where: { isActive: true },
          select: {
            tenantId: true,
            role: true,
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
                plan: true,
                isActive: true
              }
            }
          }
        }
      }
    });
  } catch (error) {
    console.error('[Super Admin] Error fetching user:', error);
    return null;
  }
}

/**
 * Get all tenants (super admin only)
 */
export async function getAllTenants() {
  try {
    return await globalPrisma.tenant.findMany({
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
    });
  } catch (error) {
    console.error('[Super Admin] Error fetching tenants:', error);
    return [];
  }
}

/**
 * Get aggregated stats across all tenants (super admin only)
 */
export async function getGlobalStats() {
  try {
    const [
      totalTenants,
      activeTenants,
      totalOrders,
      totalUsers,
      totalRevenue
    ] = await Promise.all([
      globalPrisma.tenant.count(),
      globalPrisma.tenant.count({ where: { isActive: true } }),
      globalPrisma.order.count(),
      globalPrisma.user.count({ where: { active: true } }),
      globalPrisma.order.aggregate({
        _sum: { total: true }
      })
    ]);

    return {
      totalTenants,
      activeTenants,
      totalOrders,
      totalUsers,
      totalRevenue: totalRevenue._sum.total || 0
    };
  } catch (error) {
    console.error('[Super Admin] Error fetching global stats:', error);
    return {
      totalTenants: 0,
      activeTenants: 0,
      totalOrders: 0,
      totalUsers: 0,
      totalRevenue: 0
    };
  }
}
