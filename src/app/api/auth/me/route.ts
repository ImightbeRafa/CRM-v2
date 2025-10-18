import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user details from database
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { id: true, username: true, role: true, active: true }
    });

    if (!user || !user.active) {
      return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 });
    }

    return NextResponse.json({
      status: 'success',
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        active: user.active
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
