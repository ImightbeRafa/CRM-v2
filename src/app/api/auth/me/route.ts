import { NextRequest, NextResponse } from 'next/server';
import { getLiveToken } from '@/lib/live-token';
import { getMembershipSummaryForToken } from '@/lib/selected-tenant';

export async function GET(request: NextRequest) {
  try {
    const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // One lean query (cached 30 s): membership + business name + the user's own profile fields.
    const membership = await getMembershipSummaryForToken(token);
    if (!membership) {
      return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
    }
    const user = membership.user;
    if (!user.active) {
      return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 });
    }

    // Preserve the legacy OWNER -> MASTER UI compatibility only.
    const role = membership.role === 'OWNER' ? 'MASTER' : membership.role;

    return NextResponse.json({
      status: 'success',
      data: {
        id: user.id,
        username: user.username || user.email,
        email: user.email,
        role: role,
        membershipRole: membership.role,
        active: user.active,
        tenant: { id: membership.tenant.id, name: membership.tenant.name },
      }
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user information' },
      { status: 500 }
    );
  }
}
