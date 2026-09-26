import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { authOptions } from './auth-options';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { canAccessLogistics } from './logistics-access';

function membershipTenantIdsFromToken(token: any): string[] {
  const fromMemberships = Array.isArray(token?.memberships)
    ? token.memberships.map((m: any) => m?.tenantId || m?.tenant?.id).filter(Boolean)
    : []
  const fromAll = Array.isArray(token?.allTenantIds) ? token.allTenantIds.filter(Boolean) : []
  return Array.from(new Set([...fromMemberships, ...fromAll]))
}

/**
 * Server component / layout guard.
 * Logistics is DeepSleep-only: isLogisticsAdmin AND active DeepSleep membership.
 */
export async function requireLogisticsAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;
    const membershipTenantIds =
      (session.user as any).allTenantIds ||
      ((session.user as any).memberships || []).map((m: any) => m.tenantId || m.tenant?.id)
    if (!canAccessLogistics({
      isLogisticsAdmin: session.user.isLogisticsAdmin,
      membershipTenantIds,
    })) {
        return null;
    }
    return session;
}

/**
 * API route guard — returns a 403 Response if the user is not allowed;
 * returns null if the user IS allowed (caller proceeds normally).
 */
export async function guardLogisticsApi(req: NextRequest): Promise<NextResponse | null> {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    const token = await getToken({ req, secret: secret || '' });

    if (!token || !canAccessLogistics({
      isLogisticsAdmin: Boolean(token.isLogisticsAdmin),
      membershipTenantIds: membershipTenantIdsFromToken(token),
    })) {
        return NextResponse.json(
            { error: 'Forbidden', message: 'DeepSleep logistics access required' },
            { status: 403 }
        );
    }
    return null;
}
