/**
 * Authentication & Authorization Helpers
 *
 * Helper functions for protecting pages and API routes
 * with authentication and role-based access control.
 *
 * SERVER-ONLY: Client Components must not import this module (pulls Prisma via
 * auth-options / billing-access). Use `@/lib/session-permissions` instead.
 */

import 'server-only'

import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from './auth-options';
import { Permission, Role, hasPermission } from './rbac';
import { guardTenantWrite } from './billing-access';
import { readVerifiedAuthContext } from './internal-auth-context';
import { sessionStillValid } from './session-revocation';

export { getSessionRole, getSessionTenantId, hasSessionPermission } from './session-permissions';

/**
 * Get the current session or redirect to login
 * Use in Server Components
 */
export async function requireAuth() {
  const session = await getServerSession(authOptions);

  // A session cleared by deactivation / revocation still has `user`, with an empty id.
  if (!session || !session.user || !(session.user as { id?: string }).id) {
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
 * User-level authentication for routes that only touch the caller's OWN user record (business
 * switch): signed middleware context + user-level revocation check, no business scope and no billing
 * write guard (a restricted business must not trap its members; SecureDog L3). Never use it for
 * routes that read or write business data.
 */
export async function authenticateUserOnly(request: NextRequest) {
  // Signed middleware context only (every /api/* request gets one); no weaker fallback (N3).
  const ctx = await readVerifiedAuthContext(request.headers);
  if (!ctx?.userId) return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!(await sessionStillValid(ctx.userId, ctx.sv))) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized', code: 'session_revoked' }, { status: 401 }) };
  }
  // The business / role below are what the session CLAIMS; they are not re-checked here. Only
  // for labelling (audit rows), never for authorization.
  return { ok: true as const, userId: ctx.userId, unverifiedTenantId: ctx.tenantId || null, unverifiedRole: (ctx.role || 'VIEWER') as Role };
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
export type AuthenticateOptions = {
  /**
   * Legal obligations (Ley 8968 customer erasure) must work even when the business's plan is
   * restricted for billing reasons. Use ONLY for such routes.
   */
  skipBillingWriteGuard?: boolean;
};

export async function authenticateAPI(request: NextRequest, options: AuthenticateOptions = {}) {
  // Fast path: middleware-injected headers (avoids a redundant JWT decode), trusted only when
  // signed by the middleware. Unsigned / forged headers fall through to the session check.
  const ctx = await readVerifiedAuthContext(request.headers);

  if (ctx?.tenantId) {
    // Deactivated user, revoked session (password reset), removed from this business or role
    // downgraded: cached 60 s per process.
    if (!(await sessionStillValid(ctx.userId, ctx.sv, { tenantId: ctx.tenantId, role: ctx.role }))) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: 'Unauthorized', code: 'session_revoked' }, { status: 401 }),
      };
    }
    const auth = {
      ok: true as const,
      session: null,
      tenantId: ctx.tenantId,
      role: (ctx.role || 'VIEWER') as Role,
      userId: ctx.userId,
    };
    return options.skipBillingWriteGuard ? auth : applyBillingWriteGuard(request, auth);
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

  const auth = {
    ok: true as const,
    session,
    tenantId: tenantId as string,
    role: role,
    userId: session.user.id || session.user.email || '',
  };
  return options.skipBillingWriteGuard ? auth : applyBillingWriteGuard(request, auth);
}

async function applyBillingWriteGuard<T extends {
  ok: true;
  tenantId: string;
}>(request: NextRequest, auth: T): Promise<T | { ok: false; response: NextResponse }> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return auth;

  try {
    const guard = await guardTenantWrite(auth.tenantId, {
      channel: 'api',
      route: request.nextUrl.pathname,
    });
    return guard.allowed ? auth : { ok: false as const, response: guard.response };
  } catch (error) {
    console.error('[BillingAccess] Failed to evaluate tenant write', {
      route: request.nextUrl.pathname,
      code: error instanceof Error ? error.name : 'evaluation_error',
    });
    return {
      ok: false as const,
      response: NextResponse.json({
        error: 'Unable to verify tenant billing access',
        code: 'billing_access_unavailable',
      }, { status: 503 }),
    };
  }
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
  permission: Permission,
  options: AuthenticateOptions = {},
) {
  const auth = await authenticateAPI(request, options);

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

// Client-safe session helpers live in ./session-permissions and are re-exported
// above for server callers. Do not reintroduce Prisma-touching imports there.
