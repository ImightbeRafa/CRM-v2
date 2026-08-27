import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { withTenantContext } from '@/lib/tenantContext';
import { TenantError } from '@/lib/errors';
import { isIntegrationOriginAllowed } from '@/lib/integration-cors';

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live https://app.tilopay.com https://accounts.google.com https://www.googletagmanager.com https://api.tokenex.com https://storage.googleapis.com https://connect.facebook.net https://staticxx.facebook.com https://www.facebook.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https: blob: https://*.facebook.com https://*.fbcdn.net https://storage.googleapis.com https://vercel.com https://vercel.live https://*.vercel.app https://*.vercel-storage.com",
  "connect-src 'self' https://app.tilopay.com https://api.tilopay.com https://api.tokenex.com https://vercel.live https://*.vercel-storage.com https://accounts.google.com https://connect.facebook.net https://graph.facebook.com https://www.facebook.com https://static.cloudflareinsights.com https://*.ingest.us.sentry.io",
  "worker-src 'self' blob:",
  "frame-src 'self' https://app.tilopay.com https://api.tokenex.com https://accounts.google.com https://www.facebook.com https://web.facebook.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://www.facebook.com",
  "frame-ancestors 'self'",
].join('; ');

const PUBLIC_ROUTES = [
  '/auth/signin',
  '/auth/error',
  '/api/auth',
  '/home',
  '/_next',
  '/favicon.ico',
  '/public',
  '/api/ping',
  '/api/contact',
  '/work-clock',
  '/api/work-clock',
  '/api/tilopay/webhook',
  '/api/tilopay/webhook-repeat',
  '/api/tilopay/callback',
  '/api/stripe/webhook',
  '/api/chat/webhook',                          // Meta webhooks (Instagram/WhatsApp/Facebook)
  '/api/integration',                           // Allow external website integrations (includes /test and /orders/create)
  '/api/finance',                               // External finance read API (authenticated via FINANCE_API_KEY in handler)
  '/api/bot/telegram/webhook',                  // Telegram bot webhook (must be public)
  '/api/bot/telegram/health',                   // Telegram health check (diagnostic)
  '/api/bot/whatsapp/webhook',                  // WhatsApp bot webhook (must be public for Meta verification)
  '/api/auth/instagram/data-deletion',          // Meta data deletion callback (must be public)
  '/api/cron',                                  // Vercel cron jobs (authenticated via CRON_SECRET in handler)
  '/privacy',                                   // Privacy policy (required for Meta verification)
  '/terms',                                     // Terms of service (required for Meta verification)
  '/data-deletion',                             // Data deletion instructions (required for Meta)
  '/docs',                                      // Public documentation (no auth required)
  '/monitoring',                                 // Sentry tunnel route (must be public for client-side error reporting)
];

/**
 * Middleware to handle authentication and tenant isolation
 */
export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Strip internal auth headers to prevent client-side spoofing.
  // Only middleware may set these after JWT validation.
  const sanitizedHeaders = new Headers(request.headers);
  sanitizedHeaders.delete('x-user-id');
  sanitizedHeaders.delete('x-user-role');
  sanitizedHeaders.delete('x-tenant-id');
  sanitizedHeaders.delete('x-user-email');
  const cleanFwd = { request: { headers: sanitizedHeaders } };

  const origin = sanitizedHeaders.get('origin');

  // Integration CORS must run before public route early-return (preflight needs headers)
  if (origin && pathname.startsWith('/api/integration')) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Middleware] Integration API request from origin: ${origin}, path: ${pathname}`);
    }

    if (!isIntegrationOriginAllowed(origin)) {
      return NextResponse.json(
        { error: 'Origin not allowed' },
        { status: 403, headers: { Vary: 'Origin' } },
      );
    }

    const response = NextResponse.next(cleanFwd);
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    response.headers.set('Vary', 'Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: response.headers });
    }

    return response;
  }

  // Fast path: skip all work for public routes (no CORS, no auth)
  // Root path must be public so the page.tsx redirect to /home can execute
  if (pathname === '/' || isPublicRoute(pathname)) {
    return NextResponse.next(cleanFwd);
  }

  if (origin) {
    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? ['https://betsycrm.com']
      : ['http://localhost:3000', 'https://gaynell-nonparental-marlin.ngrok-free.dev'];

    if (allowedOrigins.includes(origin)) {
      const response = NextResponse.next();
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Allow-Credentials', 'true');

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: response.headers });
      }
    }
  }

  try {
    // Get session token
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('[Middleware] NEXTAUTH_SECRET is not set');
      return redirectToLogin(url);
    }
    const token = await getToken({
      req: request as any,
      secret,
    });

    // Redirect to login if no token
    if (!token) {
      return redirectToLogin(url);
    }

    // Reject sessions cleared after user deactivation (JWT refresh sets error)
    if ((token as { error?: string; active?: boolean }).error === 'inactive_user' ||
        (token as { active?: boolean }).active === false) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'Account deactivated' },
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return redirectToLogin(url);
    }

    const tenantId = token.tenantId as string | undefined;
    const userId = token.sub;
    const legacyRole = (token.role as string) || 'VIEWER';
    const role = (token as any).currentTenant?.role
      || (legacyRole === 'MASTER' ? 'OWNER' : 'VIEWER');
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

    // Inject auth context as request headers so route handlers can skip getToken()
    const requestHeaders = new Headers(sanitizedHeaders);
    requestHeaders.set('x-user-id', userId);
    requestHeaders.set('x-user-role', role);
    if (tenantId) requestHeaders.set('x-tenant-id', tenantId);

    // Logistics dashboard — check early before tenant validation
    if (pathname.startsWith('/logistics') || pathname.startsWith('/api/logistics/')) {
      const isLogisticsAdmin = (token as any)?.isLogisticsAdmin === true;
      if (!isLogisticsAdmin) {
        if (pathname.startsWith('/api/logistics/')) {
          return new NextResponse(
            JSON.stringify({ error: 'Forbidden', message: 'Logistics admin access required' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return NextResponse.redirect(new URL('/dashboard', url.origin));
      }
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Redirect disabled features to dashboard
    if (pathname === '/chats' || pathname.startsWith('/chats/')) {
      return NextResponse.redirect(new URL('/dashboard', url.origin));
    }

    // Handle tenant-specific routes
    if (pathname.startsWith('/api/')) {
      return handleApiRequest(request, { tenantId, userId, role, legacyRole }, token, requestHeaders);
    }

    // Handle app routes
    return handleAppRoute(request, { tenantId, userId, role, legacyRole, email_verified }, token, requestHeaders);
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
  context: { tenantId?: string | null; userId: string; role: string; legacyRole: string },
  token: any,
  requestHeaders: Headers
): Promise<NextResponse> {
  const { tenantId, userId, role, legacyRole } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const fwd = { request: { headers: requestHeaders } };

  // Allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next(fwd);
  }

  // Allow auth-related routes
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next(fwd);
  }

  // Logistics admin routes — already checked in main middleware, just forward
  if (pathname.startsWith('/api/logistics/')) {
    return NextResponse.next(fwd);
  }

  // Allow tenant setup routes for MASTER users
  if (pathname.startsWith('/api/tenant/setup')) {
    if (legacyRole === 'MASTER') {
      return NextResponse.next(fwd);
    }
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Allow other setup-related routes for MASTER users without tenant
  if (!tenantId) {
    if (legacyRole === 'MASTER' &&
      (pathname.startsWith('/api/setup') ||
        pathname.startsWith('/api/tenant'))) {
      return NextResponse.next(fwd);
    }

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
        const response = NextResponse.next(fwd);
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
  context: { tenantId?: string; userId: string; role: string; legacyRole: string; email_verified?: boolean },
  token: any,
  requestHeaders: Headers
): Promise<NextResponse> {
  const { tenantId, userId, role, legacyRole, email_verified } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const fwd = { request: { headers: requestHeaders } };

  // Handle tenant setup flow - allow access to setup/auth pages without tenant
  const setupRoutes = ['/setup-tenant', '/setup-wizard', '/auth/verify-email', '/auth/verify-phone', '/auth/signin', '/auth/error'];
  const isSetupRoute = setupRoutes.some(route => pathname === route || pathname.startsWith(route));

  if (!tenantId) {
    // Allow access to setup routes, auth routes, and public routes
    if (isSetupRoute || pathname.startsWith('/api/auth/')) {
      return NextResponse.next(fwd);
    }

    // If email not verified, redirect to verify email
    if (email_verified === false) {
      return NextResponse.redirect(new URL(`/auth/verify-email?email=${token?.email || ''}`, url.origin));
    }

    // Otherwise redirect to setup-tenant (which will redirect to setup-wizard)
    if (pathname !== '/setup-tenant') {
      return NextResponse.redirect(new URL('/setup-tenant', url.origin));
    }

    return NextResponse.next(fwd);
  }

  // Restrict admin routes to MASTER role (legacy check)
  if (pathname.startsWith('/admin') && role !== 'OWNER') {
    return NextResponse.redirect(new URL('/', url.origin));
  }

  // Setup wizard is now optional - users can access it from the dashboard if needed
  // No blocking logic - users can navigate freely throughout the application

  // Billing is evaluated from current database state inside every business write.
  // JWT subscription fields and page redirects are intentionally non-authoritative.

  // Run the request with tenant context
  return withTenantContext(
    { tenantId, userId, role },
    async () => {
      const response = NextResponse.next(fwd);
      response.headers.set('x-tenant-id', tenantId);
      response.headers.set('Content-Security-Policy', CSP_HEADER);
      return response;
    }
  );
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
