import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { withTenantContext } from '@/lib/tenantContext';
import { TenantError } from '@/lib/errors';

const PUBLIC_ROUTES = [
  '/auth/signin',
  '/auth/error',
  '/api/auth',
  '/landing',
  '/home',
  '/_next',
  '/favicon.ico',
  '/public',
  '/api/ping',
  '/api/contact',
  '/api/tilopay/webhook',
  '/api/tilopay/webhook-repeat',
  '/api/tilopay/callback',
  '/api/stripe/webhook',
  '/api/chat/webhook',                          // Meta webhooks (Instagram/WhatsApp/Facebook)
  '/api/integration',                           // Allow external website integrations (includes /test and /orders/create)
  '/api/bot/telegram/webhook',                  // Telegram bot webhook (must be public)
  '/api/bot/telegram/test-webhook',             // Telegram test webhook (diagnostic)
  '/api/bot/telegram/health',                   // Telegram health check (diagnostic)
  '/api/bot/whatsapp/webhook',                  // WhatsApp bot webhook (must be public for Meta verification)
  '/api/auth/instagram/data-deletion',          // Meta data deletion callback (must be public)
  '/privacy',                                   // Privacy policy (required for Meta verification)
  '/terms',                                     // Terms of service (required for Meta verification)
  '/data-deletion',                             // Data deletion instructions (required for Meta)
];

/**
 * Middleware to handle authentication and tenant isolation
 */
export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;
  const origin = request.headers.get('origin');

  // CORS Configuration - Allow integration API from external websites
  if (origin && pathname.startsWith('/api/integration')) {
    console.log(`[Middleware] Integration API request from origin: ${origin}, path: ${pathname}, method: ${request.method}`);
    
    // For integration endpoints, allow any origin (API key auth provides security)
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      console.log(`[Middleware] Handling OPTIONS preflight for ${pathname}`);
      return new Response(null, { status: 200, headers: response.headers });
    }
    
    console.log(`[Middleware] Allowing integration request to proceed`);
  } else if (origin) {
    // For other endpoints, restrict to allowed origins
    const allowedOrigins = process.env.NODE_ENV === 'production' 
      ? ['https://your-production-domain.com'] // Update with actual production domain
      : ['http://localhost:3000', 'https://gaynell-nonparental-marlin.ngrok-free.dev']; // Allow ngrok for development
    
    if (allowedOrigins.includes(origin)) {
      const response = NextResponse.next();
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      
      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: response.headers });
      }
    }
  }

  // Skip middleware for public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  try {
    // Get session token
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('NEXTAUTH_SECRET must be set in production');
    }
    const token = await getToken({
      req: request as any,
      secret: secret || 'dev-secret-localhost-only',
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
      // For API routes, return JSON; for app routes, redirect
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'Invalid session' },
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return redirectToLogin(url);
    }

    // Handle tenant-specific routes
    if (pathname.startsWith('/api/')) {
      return handleApiRequest(request, { tenantId, userId, role });
    }

    // Handle app routes
    return handleAppRoute(request, { tenantId, userId, role, email_verified });
  } catch (error) {
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
 * For API routes, return JSON error instead of redirect
 */
function redirectToLogin(url: URL): NextResponse {
  const pathname = url.pathname;
  
  // For API routes, return JSON error instead of HTML redirect
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // For app routes, redirect to login page
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
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret && process.env.NODE_ENV === 'production') {
        throw new Error('NEXTAUTH_SECRET must be set in production');
      }
      const token = await getToken({
        req: request as any,
        secret: secret || 'dev-secret-localhost-only',
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

  // Setup wizard is now optional - users can access it from the dashboard if needed
  // No blocking logic - users can navigate freely throughout the application

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
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret && process.env.NODE_ENV === 'production') {
        throw new Error('NEXTAUTH_SECRET must be set in production');
      }
      const token = await getToken({
        req: request as any,
        secret: secret || 'dev-secret-localhost-only',
      });
      const currentTenant = (token as any)?.currentTenant;
      const plan = currentTenant?.plan || 'FREE';
      const subscriptionStatus = currentTenant?.subscriptionStatus || null;
      const trialEndsAt = currentTenant?.trialEndsAt ? new Date(currentTenant.trialEndsAt) : null;
      
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
      
      if (shouldRestrict) {
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
          return NextResponse.redirect(new URL('/config?tab=billing', url.origin));
        }
        // Block all other routes - redirect to billing
        else {
          return NextResponse.redirect(new URL('/config?tab=billing', url.origin));
        }
      }
    } catch (error) {
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
      
      // Content Security Policy (Report-Only for monitoring)
      // Adjust to your needs; switch to enforced by removing '-Report-Only' once stable
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live https://app.tilopay.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://vercel.com https://vercel.live https://*.vercel.app https://*.vercel-storage.com",
        "connect-src 'self' https://app.tilopay.com https://api.tilopay.com https://vercel.live https://*.vercel-storage.com",
        "frame-src 'self' https://app.tilopay.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
      ].join('; ');
      response.headers.set('Content-Security-Policy-Report-Only', csp);
      
      return response;
    }
  );
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
