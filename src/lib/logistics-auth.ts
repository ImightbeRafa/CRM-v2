import { getServerSession } from 'next-auth';
import { getLiveToken } from './live-token';
import { prisma } from './db';
import { authOptions } from './auth-options';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { canAccessLogistics } from './logistics-access';

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
    // Revocation-aware (reset / deactivation end access) and the grant itself is re-read from
    // the database: a token minted before isLogisticsAdmin was removed must not keep payroll /
    // costs access for up to 24 h (AUTH-26).
    const token = await getLiveToken({ req, secret: secret || '' });
    const current = token?.sub
      ? await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            isLogisticsAdmin: true,
            memberships: { where: { isActive: true }, select: { tenantId: true } },
          },
        })
      : null;

    if (!token || !current || !canAccessLogistics({
      isLogisticsAdmin: current.isLogisticsAdmin === true,
      membershipTenantIds: current.memberships.map((m) => m.tenantId),
    })) {
        return NextResponse.json(
            { error: 'Forbidden', message: 'DeepSleep logistics access required' },
            { status: 403 }
        );
    }
    return null;
}
