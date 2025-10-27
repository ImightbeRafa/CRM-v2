// middleware.ts
import { NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

/**
 * Global Middleware
 * 
 * Handles authentication and authorization for all routes
 * 
 * Public routes (no auth required):
 * - /auth/* - Authentication pages
 * - /api/auth/* - NextAuth endpoints
 * - /api/tilopay/webhook* - Tilopay webhook endpoints (verified via shared secret)
 * - /api/stripe/webhook - Stripe webhook endpoint
 * - /landing - Landing page
 * 
 * Protected routes:
 * - /config - Restricted to MASTER role only
 * - All other routes - Require valid authentication token
 */
export default async function middleware(request: Request & { nextUrl: URL }) {
  const { pathname } = (request as any).nextUrl
  
  console.log(`[Middleware] Processing: ${pathname}`);
  
  // Check if this is a webhook route first - these should NEVER be authenticated
  if (pathname.startsWith("/api/tilopay/webhook") || 
      pathname.startsWith("/api/tilopay/callback") || 
      pathname.startsWith("/api/stripe/webhook")) {
    console.log(`[Middleware] ✅ Webhook route (public): ${pathname}`);
    return NextResponse.next();
  }
  
  // Skip auth for other public routes
  const publicRoutes = [
    "/auth/signin", 
    "/auth/error", 
    "/api/auth",
    "/landing"
  ];
  
  const isPublic = publicRoutes.some((route) => pathname.startsWith(route));
  if (isPublic) {
    console.log(`[Middleware] ✅ Public route: ${pathname}`);
    return NextResponse.next();
  }

  // Require authentication for all other routes
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET || "dev-secret" })
  if (!token) {
    console.log(`[Middleware] ❌ Unauthorized access attempt: ${pathname}`);
    const url = new URL("/auth/signin", (request as any).nextUrl)
    return NextResponse.redirect(url)
  }

  // Restrict /config to MASTER role only
  if (pathname.startsWith('/config')) {
    if ((token as any).role !== 'MASTER') {
      console.log(`[Middleware] ❌ Forbidden: ${(token as any).email} attempted to access ${pathname}`);
      const url = new URL('/', (request as any).nextUrl)
      return NextResponse.redirect(url)
    }
  }

  console.log(`[Middleware] ✅ Authenticated route: ${pathname}`);
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|public/|api/auth).*)",
  ],
}