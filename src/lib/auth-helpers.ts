/**
 * Authentication & Authorization Helpers
 * 
 * Helper functions for protecting pages and API routes
 * with authentication and role-based access control
 */

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from './auth-options';
import { Permission, Role, hasPermission } from './rbac';

/**
 * Get the current session or redirect to login
 * Use in Server Components
 */
export async function requireAuth() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    redirect('/auth/signin');
  }

  return session;
}

/**
 * Require a specific permission or redirect
 * Use in Server Components for role-based pages
 * 
 * @example
 * await requirePermission('update_config');
 */
export async function requirePermission(permission: Permission) {
  const session = await requireAuth();

  const userRole = (session.user as any).role as string | undefined;
  const membershipRole = (session.user as any).membershipRole as string | undefined;
  const tenantId = (session.user as any).tenantId;

  // Use membership role if available, fallback to user role
  let role = membershipRole || userRole || 'VIEWER';
  
  // Map legacy roles to RBAC roles
  if (role === 'MASTER') {
    role = 'OWNER';
  } else if (role === 'REGULAR') {
    // For REGULAR, try to get role from membership or default to VIEWER
    if (session.user.currentTenant?.role) {
      role = session.user.currentTenant.role as Role;
    } else {
      role = tenantId ? 'VIEWER' : 'OWNER';
    }
  }

  // If user doesn't have a tenant, they should be in setup mode
  // Allow OWNER role users to access setup-related permissions even without tenant
  if (!tenantId && (role === 'OWNER' || role === 'MASTER')) {
    // For setup-related permissions, allow access even without tenant
    if (permission === 'view_config' || permission === 'update_config' || permission === 'manage_tenant') {
      return { session, role: 'OWNER' as Role };
    }
  }

  if (!hasPermission(role as Role, permission)) {
    redirect('/unauthorized');
  }

  return { session, role };
}

/**
 * Get session with tenant info
 * Returns session with tenantId and role, or redirects to login
 */
export async function getSessionWithTenant() {
  const session = await requireAuth();

  const tenantId = (session.user as any).tenantId;
  const membershipRole = (session.user as any).membershipRole;
  const role = (membershipRole || 'VIEWER') as Role;

  if (!tenantId) {
    // User doesn't have a tenant, redirect to setup
    redirect('/setup-tenant');
  }

  return {
    session,
    tenantId,
    role: role,
    userId: session.user.id || session.user.email,
  };
}

/**
 * API route authentication
 * Returns session and tenant info or error response
 * 
 * @example
 * const auth = await authenticateAPI(request);
 * if (!auth.ok) return auth.response;
 * const { session, tenantId, role } = auth;
 */
export async function authenticateAPI(request: NextRequest) {
  // Fast path: read middleware-injected headers (avoids redundant JWT decode)
  const headerUserId = request.headers.get('x-user-id');
  const headerRole = request.headers.get('x-user-role');
  const headerTenantId = request.headers.get('x-tenant-id');

  if (headerUserId && headerTenantId) {
    return {
      ok: true as const,
      session: null,
      tenantId: headerTenantId,
      role: (headerRole || 'VIEWER') as Role,
      userId: headerUserId,
    };
  }

  // Fallback: full session check (for routes where middleware didn't inject headers)
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  const tenantId = (session.user as any).tenantId;
  const membershipRole = (session.user as any).membershipRole;
  const role = (membershipRole || 'VIEWER') as Role;

  if (!tenantId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Tenant not found' },
        { status: 400 }
      ),
    };
  }

  return {
    ok: true as const,
    session,
    tenantId: tenantId as string,
    role: role,
    userId: session.user.id || session.user.email || '',
  };
}

/**
 * API route with permission check
 * 
 * @example
 * const auth = await authenticateAPIWithPermission(request, 'create_sales');
 * if (!auth.ok) return auth.response;
 */
export async function authenticateAPIWithPermission(
  request: NextRequest,
  permission: Permission
) {
  const auth = await authenticateAPI(request);

  if (!auth.ok) {
    return auth;
  }

  if (!hasPermission(auth.role, permission)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Forbidden: Insufficient permissions' },
        { status: 403 }
      ),
    };
  }

  return auth;
}

/**
 * Check if current user has permission (for client components)
 * Note: This should be used with session from useSession()
 */
export function hasSessionPermission(session: any, permission: Permission): boolean {
  if (!session?.user) return false;

  const role = session.user.membershipRole || session.user.role || 'VIEWER';
  return hasPermission(role as Role, permission);
}

/**
 * Get user's role from session (helper)
 */
export function getSessionRole(session: any): Role {
  if (!session?.user) return 'VIEWER';
  return (session.user.membershipRole || session.user.role || 'VIEWER') as Role;
}

/**
 * Get user's tenant ID from session (helper)
 */
export function getSessionTenantId(session: any): string | null {
  return session?.user?.tenantId || null;
}
