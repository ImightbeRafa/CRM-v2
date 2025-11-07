import { getToken } from "next-auth/jwt"

export async function requireAdmin(request: Request) {
  const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
  if (!token || (token as any).role !== 'MASTER') {
    return { authorized: false }
  }
  return { authorized: true }
}


