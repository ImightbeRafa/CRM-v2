import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

/**
 * POST /api/setup/wizard-complete
 * Marks the profile as completed for the current tenant
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = (session.user as any).tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant found' },
        { status: 400 }
      );
    }

    // Update tenant to mark profile as completed
    // @ts-ignore - profileCompleted exists in schema, regenerate Prisma client if TypeScript complains
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { profileCompleted: true } as any,
      select: { id: true, profileCompleted: true } as any
    });

    console.log(`✅ Profile marked as completed for tenant ${tenantId}`);

    return NextResponse.json({ 
      success: true,
      message: 'Profile marked as completed',
      tenant: updatedTenant
    });
  } catch (error) {
    console.error('Error marking profile as complete:', error);
    return NextResponse.json(
      { error: 'Failed to mark profile as complete' },
      { status: 500 }
    );
  }
}
