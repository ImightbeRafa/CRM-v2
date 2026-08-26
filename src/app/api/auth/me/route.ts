import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken } from '@/lib/selected-tenant';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await getMembershipForToken(token);
    if (!membership) {
      return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
    }

    // Get profile fields without selecting an unrelated membership.
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { 
        id: true, 
        username: true, 
        email: true,
        active: true,
      }
    });

    if (!user || !user.active) {
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
