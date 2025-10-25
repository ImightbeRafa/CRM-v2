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
    return handleAppRoute(request, { tenantId, userId, role });
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
  return PUBLIC_ROUTES.some(route => {
    if (route.endsWith('*')) {
      return pathname.startsWith(route.slice(0, -1));
    }
    return pathname === route || pathname.startsWith(`${route}/`);
  });
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
  context: { tenantId?: string; userId: string; role: string }
): Promise<NextResponse> {
  const { tenantId, userId, role } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Special handling for tenant setup routes
  if (pathname.startsWith('/api/tenant/setup')) {
    return NextResponse.next();
  }

  // Require tenant ID for all other API routes
  if (!tenantId) {
    throw new TenantError('Tenant ID is required');
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

/**
 * Handle application routes with tenant context
 */
async function handleAppRoute(
  request: Request,
  context: { tenantId?: string; userId: string; role: string }
): Promise<NextResponse> {
  const { tenantId, userId, role } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Handle tenant setup flow
  if (!tenantId) {
    if (role === 'MASTER' && pathname.startsWith('/setup-tenant')) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/setup-tenant', url.origin));
  }

  // Restrict admin routes to MASTER role
  if (pathname.startsWith('/admin') && role !== 'MASTER') {
    return NextResponse.redirect(new URL('/', url.origin));
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
