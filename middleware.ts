// middleware.ts
import { NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { config as appConfig } from "@/lib/config"

export default async function middleware(request: Request & { nextUrl: URL }) {
  // Skip auth for public routes
  const { pathname } = (request as any).nextUrl
  const isPublic = ["/auth/signin", "/auth/error", "/api/auth"].some((p) => pathname.startsWith(p))
  if (isPublic) return NextResponse.next()

  // In demo mode, allow everything but ensure a token for app routes
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET || "dev-secret" })
  if (!token) {
    const url = new URL("/auth/signin", (request as any).nextUrl)
    return NextResponse.redirect(url)
  }

  // Restrict /config to MASTER only
  if (pathname.startsWith('/config')) {
    if ((token as any).role !== 'MASTER') {
      const url = new URL('/', (request as any).nextUrl)
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/|favicon.ico|public/|api/auth).*)",
  ],
}