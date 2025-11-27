// middleware.ts - Comprehensive authentication and tenant isolation
import { NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

// Validate NEXTAUTH_SECRET is set (fail fast in production)
if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_SECRET) {
  throw new Error('NEXTAUTH_SECRET must be set in production environment');
}

/**
 * Public routes that don't require authentication me bad
 */
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
  '/api/chat/webhook',
  
]

/**
 * Check if a route is public
 */
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(route => {
    if (route.endsWith('*')) {
      return pathname.startsWith(route.slice(0, -1))
    }
    return pathname === route || pathname.startsWith(`${route}/`)
  })
}

/**
 * Redirect to login page with callback URL
 * For API routes, return JSON error instead of redirect
 */
function redirectToLogin(url: URL): NextResponse {
  const pathname = url.pathname
  
  // For API routes, return JSON error instead of HTML redirect
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  // For app routes, redirect to login page
  const loginUrl = new URL('/auth/signin', url.origin)
  loginUrl.searchParams.set('callbackUrl', url.pathname)
  return NextResponse.redirect(loginUrl)
}

/**
 * Global Middleware
 * 
 * Handles authentication and authorization for all routes
 * CRITICAL: API routes return JSON errors, not HTML redirects
 */
export default async function middleware(request: Request & { nextUrl: URL }) {
  const url = new URL(request.url)
  const { pathname } = url
  
  // Skip middleware for public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next()
  }

  try {
    // Get session token
    const token = await getToken({
      req: request as any,
      secret: process.env.NEXTAUTH_SECRET,
    })

    // Integration API routes use API key authentication, bypass session check
    if (pathname.startsWith('/api/integration/')) {
      return NextResponse.next()
    }

    // Redirect to login if no token
    if (!token) {
      return redirectToLogin(url)
    }

    const tenantId = token.tenantId as string | undefined
    const userId = token.sub
    const role = (token.role as string) || 'VIEWER'
    const email_verified = (token.email_verified as boolean) !== false

    // Validate required fields
    if (!userId) {
      console.error('[Middleware] Invalid session - missing userId');
      // For API routes, return JSON; for app routes, redirect
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'Invalid session - no user ID' },
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return redirectToLogin(url)
    }

    // Handle API routes
    if (pathname.startsWith('/api/')) {
      // Allow auth-related routes
      if (pathname.startsWith('/api/auth/')) {
        return NextResponse.next()
      }

      // Allow tenant setup routes for MASTER users
      if (pathname.startsWith('/api/tenant/setup')) {
        if (role === 'MASTER') {
          return NextResponse.next()
        }
        return NextResponse.json(
          { error: 'Unauthorized', message: 'MASTER role required' },
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // For routes requiring tenant, check if tenant exists
      if (!tenantId) {
        if (role === 'MASTER' && 
            (pathname.startsWith('/api/setup') || 
             pathname.startsWith('/api/tenant'))) {
          return NextResponse.next()
        }
        
        // Return JSON error for API routes without tenant
        return NextResponse.json(
          { error: 'Setup Required', message: 'Tenant setup required. Please complete the setup process.' },
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Add tenant ID to response headers for API routes
      const response = NextResponse.next()
      response.headers.set('x-tenant-id', tenantId)
      return response
    }

    // Handle application routes
    const setupRoutes = ['/setup-tenant', '/setup-wizard', '/auth/verify-email', '/auth/signin', '/auth/error']
    const isSetupRoute = setupRoutes.some(route => pathname === route || pathname.startsWith(route))
    
    if (!tenantId) {
      // Allow access to setup routes, auth routes, and public routes
      if (isSetupRoute || pathname.startsWith('/api/auth/') || pathname.startsWith('/landing')) {
        return NextResponse.next()
      }
      
      // If email not verified, redirect to verify email
      if (email_verified === false) {
        return NextResponse.redirect(new URL(`/auth/verify-email?email=${token.email || ''}`, url.origin))
      }
      
      // Otherwise redirect to setup-tenant
      if (pathname !== '/setup-tenant') {
        return NextResponse.redirect(new URL('/setup-tenant', url.origin))
      }
      
      return NextResponse.next()
    }

    // Restrict admin routes to MASTER role
    if (pathname.startsWith('/admin') && role !== 'MASTER') {
      return NextResponse.redirect(new URL('/', url.origin))
    }

    // Restrict /config to MASTER role, except /config/social which allows OWNER and MASTER
    if (pathname.startsWith('/config')) {
      // Allow /config/social for OWNER and MASTER
      if (pathname.startsWith('/config/social')) {
        const membershipRole = (token as any).membershipRole as string | undefined
        const effectiveRole = membershipRole || role
        console.log('[Middleware] /config/social access attempt:', { role, membershipRole, effectiveRole, pathname })
        if (effectiveRole !== 'OWNER' && effectiveRole !== 'MASTER') {
          console.log('[Middleware] Blocking /config/social - insufficient role')
          return NextResponse.redirect(new URL('/', url.origin))
        }
        console.log('[Middleware] Allowing /config/social access')
      } else if (role !== 'MASTER') {
        // All other /config routes require MASTER
        return NextResponse.redirect(new URL('/', url.origin))
      }
    }

    // Check trial/subscription status for billing restrictions
    const isBillingApiRoute = pathname.startsWith('/api/billing') || 
                               pathname.startsWith('/api/tilopay/checkout') || 
                               pathname.startsWith('/api/tilopay/create-payment-link')
    const isConfigPage = pathname === '/config'
    const isBillingTab = isConfigPage && url.searchParams.get('tab') === 'billing'

    if (tenantId) {
      try {
        const currentTenant = (token as any)?.currentTenant
        const plan = currentTenant?.plan || 'FREE'
        const subscriptionStatus = currentTenant?.subscriptionStatus || null
        const trialEndsAt = currentTenant?.trialEndsAt ? new Date(currentTenant.trialEndsAt) : null
        
        // Normalize plan and status
        const normalizedPlan = plan ? String(plan).trim().toUpperCase() : 'FREE'
        const normalizedStatus = subscriptionStatus ? String(subscriptionStatus).trim().toLowerCase() : null
        
        // Check if trial expired (only for FREE plan)
        let trialExpired = false
        if (normalizedPlan === 'FREE') {
          const now = new Date()
          const trialEnd = trialEndsAt || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
          trialExpired = now >= trialEnd
        }
        
        // Check if subscription is active
        let subscriptionActive = false
        if (normalizedPlan !== 'FREE' && normalizedPlan !== '') {
          const blockingStatuses = ['canceled', 'expired', 'past_due']
          const isBlocked = normalizedStatus && blockingStatuses.includes(normalizedStatus)
          subscriptionActive = !isBlocked
        } else {
          subscriptionActive = !trialExpired
        }
        
        const shouldRestrict = trialExpired || !subscriptionActive
        
        if (shouldRestrict) {
          if (isBillingApiRoute || isBillingTab) {
            // Allow billing access
          } else if (isConfigPage && !isBillingTab) {
            return NextResponse.redirect(new URL('/config?tab=billing', url.origin))
          } else {
            return NextResponse.redirect(new URL('/config?tab=billing', url.origin))
          }
        }
      } catch (error) {
        console.error('[Middleware] Error checking billing status:', error)
      }
    }

    // Add tenant ID to response headers
    const response = NextResponse.next()
    if (tenantId) {
      response.headers.set('x-tenant-id', tenantId)
    }
    
    return response
  } catch (error) {
    console.error('[Middleware] Error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'An unexpected error occurred' },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
}