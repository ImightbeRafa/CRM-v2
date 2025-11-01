import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { withTenantContext } from '@/lib/tenantContext';
import { TenantError } from '@/lib/errors';

const PUBLIC_ROUTES = [
  '/auth/signin',
  '/auth/error',
  '/api/auth',
  '/landing',
  '/_next',
  '/favicon.ico',
  '/public',
  '/api/ping',
  '/api/tilopay/webhook',
  '/api/tilopay/webhook-repeat',
  '/api/tilopay/callback',
  '/api/stripe/webhook',
];

/**
 * Middleware to handle authentication and tenant isolation
 */
export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Skip middleware for public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  try {
    // Get session token
    const token = await getToken({
      req: request as any,
      secret: process.env.NEXTAUTH_SECRET || 'dev-secret',
    });

    // Redirect to login if no token
    if (!token) {
      return redirectToLogin(url);
    }

    const tenantId = token.tenantId as string | undefined;
    const userId = token.sub;
    const role = (token.role as string) || 'VIEWER';
    const email_verified = (token.email_verified as boolean) !== false; // Default to true if not set

    // Validate required fields
    if (!userId) {
      console.error('User ID not found in token');
      return redirectToLogin(url);
    }

    // Handle tenant-specific routes
    if (pathname.startsWith('/api/')) {
      return handleApiRequest(request, { tenantId, userId, role });
    }

    // Handle app routes
    return handleAppRoute(request, { tenantId, userId, role, email_verified });
  } catch (error) {
    console.error('Middleware error:', error);
    
    // Don't expose internal errors to the client
    if (error instanceof TenantError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode || 500 }
      );
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

/**
 * Check if a route is public
 */
function isPublicRoute(pathname: string): boolean {
  const isPublic = PUBLIC_ROUTES.some(route => {
    if (route.endsWith('*')) {
      return pathname.startsWith(route.slice(0, -1));
    }
    return pathname === route || pathname.startsWith(`${route}/`);
  });
  
  return isPublic;
}

/**
 * Redirect to login page with callback URL
 */
function redirectToLogin(url: URL): NextResponse {
  const loginUrl = new URL('/auth/signin', url.origin);
  loginUrl.searchParams.set('callbackUrl', url.pathname);
  return NextResponse.redirect(loginUrl);
}

/**
 * Handle API requests with tenant context
 */
async function handleApiRequest(
  request: Request,
  context: { tenantId?: string | null; userId: string; role: string }
): Promise<NextResponse> {
  const { tenantId, userId, role } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Allow auth-related routes
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Allow tenant setup routes for MASTER users
  if (pathname.startsWith('/api/tenant/setup')) {
    if (role === 'MASTER') {
      return NextResponse.next();
    }
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Allow other setup-related routes for MASTER users without tenant
  if (!tenantId) {
    if (role === 'MASTER' && 
        (pathname.startsWith('/api/setup') || 
         pathname.startsWith('/api/tenant'))) {
      return NextResponse.next();
    }
    
    // For other API routes, return a 400 error instead of throwing
    return new NextResponse(
      JSON.stringify({ error: 'Tenant setup required. Please complete the setup process.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Run the request with tenant context for users with a tenant
  try {
    return await withTenantContext(
      { tenantId, userId, role },
      async () => {
        const response = NextResponse.next();
        // Add tenant ID to response headers for client-side use
        response.headers.set('x-tenant-id', tenantId);
        return response;
      }
    );
  } catch (error) {
    console.error('Error in tenant context:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Failed to process request with tenant context' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle application routes with tenant context
 */
async function handleAppRoute(
  request: Request,
  context: { tenantId?: string; userId: string; role: string; email_verified?: boolean }
): Promise<NextResponse> {
  const { tenantId, userId, role, email_verified } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Handle tenant setup flow - allow access to setup/auth pages without tenant
  const setupRoutes = ['/setup-tenant', '/setup-wizard', '/auth/verify-email', '/auth/signin', '/auth/error'];
  const isSetupRoute = setupRoutes.some(route => pathname === route || pathname.startsWith(route));
  
  if (!tenantId) {
    // Allow access to setup routes, auth routes, and public routes
    if (isSetupRoute || pathname.startsWith('/api/auth/') || pathname.startsWith('/landing')) {
      return NextResponse.next();
    }
    
    // If email not verified, redirect to verify email
    if (email_verified === false) {
      const token = await getToken({
        req: request as any,
        secret: process.env.NEXTAUTH_SECRET || 'dev-secret',
      });
      return NextResponse.redirect(new URL(`/auth/verify-email?email=${token?.email || ''}`, url.origin));
    }
    
    // Otherwise redirect to setup-tenant (which will redirect to setup-wizard)
    if (pathname !== '/setup-tenant') {
      return NextResponse.redirect(new URL('/setup-tenant', url.origin));
    }
    
    return NextResponse.next();
  }

  // Restrict admin routes to MASTER role
  if (pathname.startsWith('/admin') && role !== 'MASTER') {
    return NextResponse.redirect(new URL('/', url.origin));
  }

  // Check trial/subscription status and enforce restrictions
  // Allow billing-related routes for expired trials
  const isBillingApiRoute = pathname.startsWith('/api/billing') || 
                             pathname.startsWith('/api/tilopay/checkout') || 
                             pathname.startsWith('/api/tilopay/create-payment-link');
  const isConfigPage = pathname === '/config';
  const isBillingTab = isConfigPage && url.searchParams.get('tab') === 'billing';

  // Check if trial has expired or subscription is inactive
  // Use JWT token data to avoid Prisma queries in Edge runtime
  if (tenantId) {
    try {
      // Get plan and subscription status from JWT token (set in auth-options.ts)
      const currentTenant = (token as any).currentTenant;
      const plan = currentTenant?.plan || 'FREE';
      const subscriptionStatus = currentTenant?.subscriptionStatus || null;
      const trialEndsAt = currentTenant?.trialEndsAt ? new Date(currentTenant.trialEndsAt) : null;
      
      console.log(`🔍 [MIDDLEWARE] Checking trial/subscription for tenant ${tenantId}:`, {
        plan,
        subscriptionStatus,
        trialEndsAt: trialEndsAt?.toISOString()
      });
      
      // Normalize plan (handle enum/string)
      const normalizedPlan = plan ? String(plan).trim().toUpperCase() : 'FREE';
      const normalizedStatus = subscriptionStatus ? String(subscriptionStatus).trim().toLowerCase() : null;
      
      // Check if trial expired (only for FREE plan)
      let trialExpired = false;
      if (normalizedPlan === 'FREE') {
        const now = new Date();
        const trialEnd = trialEndsAt || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // Default 15 days
        trialExpired = now >= trialEnd;
      }
      
      // Check if subscription is active
      // For paid plans (BASIC, PRO), allow unless explicitly blocked
      let subscriptionActive = false;
      if (normalizedPlan !== 'FREE' && normalizedPlan !== '') {
        // Paid plan - allow unless explicitly blocked
        const blockingStatuses = ['canceled', 'expired', 'past_due'];
        const isBlocked = normalizedStatus && blockingStatuses.includes(normalizedStatus);
        subscriptionActive = !isBlocked; // Active if not blocked
      } else {
        // FREE plan - check if trial is active
        subscriptionActive = !trialExpired;
      }
      
      // CRITICAL: Only restrict if trial expired OR subscription inactive
      const shouldRestrict = trialExpired || !subscriptionActive;
      
      console.log(`🔍 [MIDDLEWARE] Restriction decision for tenant ${tenantId}:`, {
        plan: normalizedPlan,
        subscriptionStatus: normalizedStatus,
        trialExpired,
        subscriptionActive,
        shouldRestrict,
        pathname
      });
      
      if (shouldRestrict) {
        console.log(`🔒 [MIDDLEWARE] Access RESTRICTED for tenant ${tenantId}:`, {
          plan: normalizedPlan,
          subscriptionStatus: normalizedStatus,
          trialExpired,
          subscriptionActive,
          pathname
        });
        
        // Allow billing API routes
        if (isBillingApiRoute) {
          // Allow API routes to proceed
          // Continue to normal flow below
        } 
        // Allow /config with billing tab
        else if (isBillingTab) {
          // Allow billing page to proceed
          // Continue to normal flow below
        }
        // If accessing /config but not billing tab, redirect to billing
        else if (isConfigPage && !isBillingTab) {
          console.log(`🔒 Trial expired or subscription inactive - redirecting /config to billing tab: ${pathname}`);
          return NextResponse.redirect(new URL('/config?tab=billing', url.origin));
        }
        // Block all other routes - redirect to billing
        else {
          console.log(`🔒 Trial expired or subscription inactive - redirecting to billing: ${pathname}`);
          return NextResponse.redirect(new URL('/config?tab=billing', url.origin));
        }
      } else {
        // Access allowed - paid plan or active subscription/trial
        console.log(`✅ [MIDDLEWARE] Access ALLOWED for tenant ${tenantId}:`, {
          plan: normalizedPlan,
          subscriptionStatus: normalizedStatus,
          trialExpired,
          subscriptionActive
        });
      }
    } catch (error) {
      console.error('Error checking trial/subscription status:', error);
      // On error, allow access (fail open) - don't block users due to DB errors
    }
  }

  // Run the request with tenant context
  return withTenantContext(
    { tenantId, userId, role },
    async () => {
      const response = NextResponse.next();
      
      // Add tenant ID to response headers for client-side use
      response.headers.set('x-tenant-id', tenantId);
      
      return response;
    }
  );
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
