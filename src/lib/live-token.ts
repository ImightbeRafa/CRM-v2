/**
 * `getToken` plus the session-revocation check (security, 2026-09-29). Routes that only decode the
 * NextAuth cookie never run the JWT callback, so a reset password / deactivation did not reach
 * them until the cookie expired (Verifier S3). Same result as getToken, or null when the account is
 * deactivated or its sessions were revoked (cached 60 s, fails open on DB trouble).
 */
import 'server-only'
import { getToken, type JWT } from 'next-auth/jwt'
import { sessionStillValid } from '@/lib/session-revocation'

// `req` as NextAuth's getToken accepts it (NextRequest / Request / API request).
export async function getLiveToken(params: { req: Request | { headers: unknown }; secret?: string }): Promise<JWT | null> {
  const token = (await getToken({ req: params.req as never, secret: params.secret })) as JWT | null
  if (!token?.sub) return token
  if ((token as { error?: string }).error) return null
  return (await sessionStillValid(token.sub, (token as { sv?: number }).sv)) ? token : null
}
