import { getToken } from "next-auth/jwt"
import { readVerifiedAuthContext } from "@/lib/internal-auth-context"

export async function requireAdmin(request: Request) {
  // Prefer the middleware-injected context (avoids a redundant JWT decode); only when signed.
  const ctx = await readVerifiedAuthContext(request.headers);
  if (ctx) {
    return { authorized: ctx.role === 'MASTER' };
  }

  // Fallback for public routes where middleware skips auth
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token as any).role !== 'MASTER') {
    return { authorized: false }
  }
  return { authorized: true }
}
