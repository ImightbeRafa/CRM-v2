import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user details from database with membership
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { 
        id: true, 
        username: true, 
        email: true,
        active: true,
        memberships: {
          where: { isActive: true },
          select: { 
            role: true, 
            tenant: { select: { name: true, id: true } }
          }
        }
      }
    });

    if (!user || !user.active) {
      return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 });
    }

    // Determine role from membership
    const role = user.memberships.length > 0 && user.memberships[0].role === 'OWNER' 
      ? 'MASTER' 
      : 'REGULAR';

    return NextResponse.json({
      status: 'success',
      data: {
        id: user.id,
        username: user.username || user.email,
        email: user.email,
        role: role,
        active: user.active,
        tenant: user.memberships[0]?.tenant
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
