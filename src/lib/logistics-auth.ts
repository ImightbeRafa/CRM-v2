import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { authOptions } from './auth-options';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Server component / layout guard.
 * Uses getServerSession — works now because the session callback
 * copies isLogisticsAdmin from the JWT into session.user.
 * Returns the session if admin, null if not.
 */
export async function requireLogisticsAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user || !session.user.isLogisticsAdmin) {
        return null;
    }
    return session;
}

/**
 * API route guard — returns a 403 Response if the user is not a logistics admin;
 * returns null if the user IS allowed (caller proceeds normally).
 */
export async function guardLogisticsApi(req: NextRequest): Promise<NextResponse | null> {
    const secret = process.env.NEXTAUTH_SECRET;
    const token = await getToken({ req, secret: secret || 'dev-secret-localhost-only' });

    if (!token || !token.isLogisticsAdmin) {
        return NextResponse.json(
            { error: 'Forbidden', message: 'Logistics admin access required' },
            { status: 403 }
        );
    }
    return null;
}
