import { getToken } from "next-auth/jwt"

export async function requireAdmin(request: Request) {
  // Prefer middleware-injected header (avoids redundant JWT decode)
  const headerRole = request.headers.get('x-user-role');
  if (headerRole) {
    return { authorized: headerRole === 'MASTER' };
  }

  // Fallback for public routes where middleware skips auth
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token as any).role !== 'MASTER') {
    return { authorized: false }
  }
  return { authorized: true }
}
