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
 * Middleware already blocks non-admins for /api/logistics/* so this is a
 * lightweight double-check that reads the middleware-injected header.
 */
export async function guardLogisticsApi(req: NextRequest): Promise<NextResponse | null> {
    // Middleware already verified logistics admin and injected headers;
    // if x-user-id is present, auth was done in middleware — skip getToken()
    if (req.headers.get('x-user-id')) {
        return null;
    }

    // Fallback: full JWT check (should only fire if middleware was bypassed)
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    const token = await getToken({ req, secret: secret || 'dev-secret-localhost-only' });

    if (!token || !token.isLogisticsAdmin) {
        return NextResponse.json(
            { error: 'Forbidden', message: 'Logistics admin access required' },
            { status: 403 }
        );
    }
    return null;
}
