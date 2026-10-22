/**
 * Super-admin guard for the support / custom-agent admin APIs (Rafael only).
 * Live session (revocation-aware) + DB super-admin flag; writes also need same origin.
 */
import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getLiveToken } from '@/lib/live-token'
import { isSameOriginRequest } from '@/lib/same-origin'
import { isSuperAdmin } from '@/lib/super-admin-helpers'

export async function requireSuperAdmin(
  request: NextRequest,
  opts: { write?: boolean } = {},
): Promise<{ ok: true; userId: string; name: string } | { ok: false; response: NextResponse }> {
  const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
  if (!token?.sub) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await isSuperAdmin(token.sub))) {
    return { ok: false, response: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }
  if (opts.write && !isSameOriginRequest(request)) {
    return { ok: false, response: NextResponse.json({ error: 'Origen no permitido' }, { status: 403 }) }
  }
  return { ok: true, userId: token.sub, name: String(token.name || token.email || 'Super admin').slice(0, 80) }
}
